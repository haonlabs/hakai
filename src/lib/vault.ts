/**
 * vault.ts – safe vault operations.
 *
 * All public functions go through resolveSafe() which enforces:
 *  - relative path, ends with .md, no ".." segments, no NUL bytes
 *  - realpath(join(root, relPath)) must be strictly inside realpath(root)/
 *  - the target must not be a symlink pointing outside the vault
 *  - the path must exist in audit.json
 */

import { promises as fs, type Dirent } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getVaultRoot, getAuditFile } from './config.js';
import { readAudit, removeItem } from './audit.js';
import type { Audit, AuditItem, Backlink, NoteDetail, DeleteResult } from './types.js';

// ---------------------------------------------------------------------------
// Wikilink pattern  [[name]], [[name|alias]], [[name#heading]]
// "name" = everything up to the first | # or ]]
// ---------------------------------------------------------------------------
const WIKILINK_RE = /\[\[([^\]|#]+?)(?:[|#][^\]]*?)?\]\]/g;
const CLAUDE_MEMORY_NOTE_RE = /^claude-memory\/[^/]+\/[^/]+\.md$/;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Write data to filePath atomically via a sibling temp file. */
async function writeAtomic(filePath: string, data: string): Promise<void> {
	const dir = dirname(filePath);
	const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
	try {
		await fs.writeFile(tmp, data, 'utf8');
		await fs.rename(tmp, filePath);
	} catch (err) {
		await fs.unlink(tmp).catch(() => undefined);
		throw err;
	}
}

/**
 * Remove lines linking to a note from targetFilePath.
 * A line is considered linking if it contains either:
 *  - a wikilink to the note stem (e.g. [[x]], [[x|alias]], [[x#h]]), or
 *  - a markdown link ](fileName) or ](./fileName) with exact matching filename (case-sensitive)
 *
 * Rewrites the file atomically only if at least one line was removed.
 * Ignores ENOENT if targetFilePath does not exist.
 * Preserves other lines as-is, including trailing newline.
 */
async function removePointersFromFile(targetFilePath: string, relPath: string): Promise<number> {
	let content: string;
	try {
		content = await fs.readFile(targetFilePath, 'utf8');
	} catch (err: unknown) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return 0;
		throw err;
	}

	const targetStem = basename(relPath, '.md').toLowerCase();
	const fileName = basename(relPath);
	const md1 = `](${fileName})`;
	const md2 = `](./${fileName})`;

	const lines = content.split('\n');
	const kept: string[] = [];
	let removedCount = 0;

	for (const line of lines) {
		let lineHasLink = line.includes(md1) || line.includes(md2);

		if (!lineHasLink) {
			WIKILINK_RE.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = WIKILINK_RE.exec(line)) !== null) {
				const linkStem = basename(m[1].trim(), '.md').toLowerCase();
				if (linkStem === targetStem) {
					lineHasLink = true;
					break;
				}
			}
		}

		if (lineHasLink) {
			removedCount++;
		} else {
			kept.push(line);
		}
	}

	if (removedCount > 0) {
		await writeAtomic(targetFilePath, kept.join('\n'));
	}

	return removedCount;
}

/**
 * Resolve relPath safely within root.
 * Returns the absolute path if all checks pass; throws otherwise.
 *
 * @param relPath  - relative path to the note (e.g. "inbox/foo.md")
 * @param root     - absolute vault root
 * @param audit    - already-loaded Audit object (to avoid re-reading per call)
 */
async function resolveSafe(relPath: string, root: string, audit: Audit): Promise<string> {
	// 1. Must be a non-empty string
	if (!relPath || typeof relPath !== 'string') {
		throw new Error(`Invalid path: ${JSON.stringify(relPath)}`);
	}

	// 2. No NUL bytes
	if (relPath.includes('\0')) {
		throw new Error(`Path contains NUL byte: "${relPath}"`);
	}

	// 3. Must not be absolute
	if (/^\//.test(relPath) || /^[A-Za-z]:[/\\]/.test(relPath)) {
		throw new Error(`Path must be relative, got: "${relPath}"`);
	}

	// 4. No ".." segments
	const segments = relPath.split('/');
	if (segments.some((s) => s === '..')) {
		throw new Error(`Path must not contain "..": "${relPath}"`);
	}

	// 5. Must end with .md
	if (!relPath.endsWith('.md')) {
		throw new Error(`Path must end with ".md": "${relPath}"`);
	}

	// 6. Must exist in audit
	const inAudit = audit.items.some((it) => it.path === relPath);
	if (!inAudit) {
		throw new Error(`Path not found in audit: "${relPath}"`);
	}

	const absCandidate = join(root, relPath);

	// 7. Check symlink before realpath (do not follow it)
	let lstat: Awaited<ReturnType<typeof fs.lstat>> | undefined;
	try {
		lstat = await fs.lstat(absCandidate);
	} catch {
		// File might not exist – we still need realpath-based containment check
		// (file may have been deleted; callers handle that).
	}

	if (lstat?.isSymbolicLink()) {
		// Resolve the link target and check if it stays inside root
		const linkTarget = await fs.readlink(absCandidate);
		// Determine absolute target
		const absTarget = linkTarget.startsWith('/')
			? linkTarget
			: join(dirname(absCandidate), linkTarget);
		let realTarget: string;
		try {
			realTarget = await fs.realpath(absTarget);
		} catch {
			// Target doesn't exist; consider it outside vault for safety
			throw new Error(`Symlink target does not exist or is unresolvable: "${relPath}"`);
		}
		const realRoot = await fs.realpath(root);
		if (!realTarget.startsWith(realRoot + '/') && realTarget !== realRoot) {
			throw new Error(`Symlink points outside the vault: "${relPath}"`);
		}
	}

	// 8. realpath containment check (prefix must include separator)
	const realRoot = await fs.realpath(root);

	// 8b. Realpath containment: use realpath if file exists, otherwise build a
	//     normalised absolute path from the already-resolved realRoot + relPath
	//     (relPath has no ".." by this point, so this is safe).
	const rootPrefix = realRoot.endsWith('/') ? realRoot : realRoot + '/';
	let realAbs: string;
	try {
		realAbs = await fs.realpath(absCandidate);
	} catch {
		// File doesn't exist (e.g. already deleted).
		// Reconstruct from the real root so the prefix comparison works even
		// on platforms where /tmp → /private/tmp (macOS).
		realAbs = join(realRoot, relPath);
	}

	if (!realAbs.startsWith(rootPrefix) && realAbs !== realRoot) {
		throw new Error(`Path escapes vault root: "${relPath}"`);
	}

	return absCandidate;
}

/** Recursively collect all .md files under dir, skipping .obsidian/ */
async function collectMd(dir: string): Promise<string[]> {
	const result: string[] = [];
	let entries: Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return result;
	}
	for (const ent of entries) {
		if (ent.name === '.obsidian') continue;
		const full = join(dir, ent.name);
		if (ent.isDirectory()) {
			result.push(...(await collectMd(full)));
		} else if (ent.isFile() && ent.name.endsWith('.md')) {
			result.push(full);
		}
	}
	return result;
}

/** Convert absolute path inside root to relative path with forward slashes. */
function toRelPath(absPath: string, root: string): string {
	return absPath.slice(root.length).replace(/^[/\\]/, '').replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function readNote(
	relPath: string,
	root?: string,
	auditFile?: string
): Promise<NoteDetail> {
	const vaultRoot = root ?? getVaultRoot();
	const audit = await readAudit(auditFile);
	const absPath = await resolveSafe(relPath, vaultRoot, audit);

	const [content, stat, bl] = await Promise.all([
		fs.readFile(absPath, 'utf8'),
		fs.stat(absPath),
		backlinks(relPath, vaultRoot, audit)
	]);

	const item = audit.items.find((it) => it.path === relPath)!;

	return {
		item,
		content,
		mtime: stat.mtime.toISOString(),
		backlinks: bl
	};
}

export async function backlinks(
	relPath: string,
	root?: string,
	audit?: Audit
): Promise<Backlink[]> {
	const vaultRoot = root ?? getVaultRoot();
	// Note: backlinks() does NOT call resolveSafe so it can be called internally
	// without an audit object. We just need the filename stem.
	const targetStem = basename(relPath, '.md').toLowerCase();

	const allMd = await collectMd(vaultRoot);
	const results: Backlink[] = [];

	for (const absFile of allMd) {
		const fileRelPath = toRelPath(absFile, vaultRoot);
		if (fileRelPath === relPath) continue; // skip self

		let content: string;
		try {
			content = await fs.readFile(absFile, 'utf8');
		} catch {
			continue;
		}

		let match: RegExpExecArray | null;
		WIKILINK_RE.lastIndex = 0;
		let found = false;
		while ((match = WIKILINK_RE.exec(content)) !== null) {
			const linkName = match[1].trim();
			// "name" in wikilink may include folder path; we compare only the basename (stem)
			const linkStem = basename(linkName, '.md').toLowerCase();
			if (linkStem === targetStem) {
				found = true;
				break;
			}
		}

		if (found) {
			results.push({
				path: fileRelPath,
				name: basename(absFile, '.md')
			});
		}
	}

	return results;
}

export async function listUnaudited(audit: Audit, root?: string): Promise<string[]> {
	const vaultRoot = root ?? getVaultRoot();
	const auditedPaths = new Set(audit.items.map((it) => it.path));
	const allMd = await collectMd(vaultRoot);
	return allMd
		.map((abs) => toRelPath(abs, vaultRoot))
		// index.md dan MEMORY.md = file indeks, bukan objek audit
		.filter((rel) => rel !== 'index.md' && basename(rel) !== 'MEMORY.md' && !auditedPaths.has(rel));
}

export async function deleteNote(
	relPath: string,
	root?: string,
	auditFile?: string
): Promise<DeleteResult> {
	const vaultRoot = root ?? getVaultRoot();
	const resolvedAuditFile = auditFile ?? getAuditFile();
	const audit = await readAudit(resolvedAuditFile);

	// 1. resolveSafe (may throw if path invalid/not in audit)
	const absPath = await resolveSafe(relPath, vaultRoot, audit);

	// 2. Compute backlinks that are NOT index.md (brokenLinksIn)
	const bl = await backlinks(relPath, vaultRoot, audit);
	const brokenLinksIn = bl.filter((b) => b.path !== 'index.md').map((b) => b.path);

	// 3. Delete the file (tolerate already-deleted)
	try {
		await fs.unlink(absPath);
	} catch (err: unknown) {
		const e = err as NodeJS.ErrnoException;
		if (e.code !== 'ENOENT') throw err;
		// Already gone – continue to clean up index.md and audit
	}

	// 4. Clean up pointers in index.md and (if applicable) MEMORY.md
	const indexAbs = join(vaultRoot, 'index.md');
	let indexLinesRemoved = await removePointersFromFile(indexAbs, relPath);

	const isClaudeMemoryNote =
		CLAUDE_MEMORY_NOTE_RE.test(relPath) && basename(relPath) !== 'MEMORY.md';

	if (isClaudeMemoryNote) {
		const memoryAbs = join(vaultRoot, dirname(relPath), 'MEMORY.md');
		indexLinesRemoved += await removePointersFromFile(memoryAbs, relPath);
	}

	// 5. removeItem from audit
	await removeItem(relPath, resolvedAuditFile);

	return {
		deleted: relPath,
		indexLinesRemoved,
		brokenLinksIn
	};
}
