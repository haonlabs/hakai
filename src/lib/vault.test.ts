/**
 * vault.test.ts – unit tests for src/lib/vault.ts
 *
 * All tests use a temporary directory as the vault root.
 * No access to /Users/haon/Documents/vault or any real vault.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { backlinks, listUnaudited, deleteNote, readNote } from './vault.js';
import type { Audit } from './types.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let vaultRoot: string;
let auditFile: string;

/** Build a minimal valid Audit object whose items map to files in vault. */
function makeAudit(items: Array<{ path: string }>): Audit {
	return {
		generatedAt: '2026-11-13T03:00:00.000Z',
		vaultRoot,
		items: items.map((it) => ({
			path: it.path,
			verdict: 'keep',
			reason: 'test',
			reviewed: null
		}))
	};
}

async function writeAudit(audit: Audit): Promise<void> {
	await fs.writeFile(auditFile, JSON.stringify(audit, null, 2), 'utf8');
}

/** Create a file inside vault with given content. Creates parent dirs. */
async function writeNote(relPath: string, content: string): Promise<void> {
	const abs = join(vaultRoot, relPath);
	await fs.mkdir(join(abs, '..'), { recursive: true });
	await fs.writeFile(abs, content, 'utf8');
}

beforeEach(async () => {
	tmpDir = await fs.mkdtemp('/tmp/hakai-vault-test-');
	vaultRoot = join(tmpDir, 'vault');
	await fs.mkdir(vaultRoot, { recursive: true });
	auditFile = join(tmpDir, 'audit.json');
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveSafe guard tests (exercised via readNote / deleteNote)
// ---------------------------------------------------------------------------

describe('resolveSafe guards', () => {
	it('rejects path traversal: ../x.md', async () => {
		const audit = makeAudit([]);
		// manually add the bad path to bypass audit check to reach path guard first
		const badAudit: Audit = { ...audit, items: [{ path: '../x.md', verdict: 'keep', reason: 'x', reviewed: null }] };
		await writeAudit(badAudit);
		await expect(readNote('../x.md', vaultRoot, auditFile)).rejects.toThrow(/\.\./);
	});

	it('rejects absolute path', async () => {
		const audit = makeAudit([]);
		await writeAudit(audit);
		// absolute path: skip audit by injecting directly
		const badAudit: Audit = {
			...audit,
			items: [{ path: '/etc/passwd', verdict: 'keep', reason: 'x', reviewed: null }]
		};
		await writeAudit(badAudit);
		await expect(readNote('/etc/passwd', vaultRoot, auditFile)).rejects.toThrow(
			/absolute|relative/i
		);
	});

	it('rejects path not ending in .md', async () => {
		const audit = makeAudit([]);
		await writeAudit(audit);
		await expect(deleteNote('notes/foo.txt', vaultRoot, auditFile)).rejects.toThrow(/\.md/);
	});

	it('rejects path not in audit', async () => {
		const audit = makeAudit([]);
		await writeAudit(audit);
		await expect(readNote('notes/unlisted.md', vaultRoot, auditFile)).rejects.toThrow(
			/not found in audit/i
		);
	});

	it('rejects symlink pointing outside vault', async () => {
		// Create a file outside the vault
		const outsideFile = join(tmpDir, 'secret.md');
		await fs.writeFile(outsideFile, 'secret', 'utf8');

		// Create a symlink inside vault pointing outside
		const linkPath = join(vaultRoot, 'evil.md');
		await fs.symlink(outsideFile, linkPath);

		const audit = makeAudit([{ path: 'evil.md' }]);
		await writeAudit(audit);

		await expect(readNote('evil.md', vaultRoot, auditFile)).rejects.toThrow(
			/symlink|outside/i
		);
	});

	it('rejects vault2/ prefix attack (path escaping via similar directory name)', async () => {
		// Create vault2 sibling directory with a file
		const vault2 = join(tmpDir, 'vault2');
		await fs.mkdir(vault2, { recursive: true });
		await fs.writeFile(join(vault2, 'secret.md'), 'secret', 'utf8');

		// Attempt path like "../vault2/secret.md" – should be rejected by ".." guard
		const badAudit: Audit = {
			generatedAt: '2026-11-13T03:00:00.000Z',
			vaultRoot,
			items: [{ path: '../vault2/secret.md', verdict: 'keep', reason: 'x', reviewed: null }]
		};
		await writeAudit(badAudit);
		await expect(readNote('../vault2/secret.md', vaultRoot, auditFile)).rejects.toThrow(
			/\.\.|absolute|relative|escapes/i
		);
	});
});

// ---------------------------------------------------------------------------
// backlinks
// ---------------------------------------------------------------------------

describe('backlinks', () => {
	it('detects [[name]] wikilink', async () => {
		await writeNote('target.md', '# Target');
		await writeNote('source.md', 'See [[target]] for more.');
		const bl = await backlinks('target.md', vaultRoot);
		expect(bl.map((b) => b.path)).toContain('source.md');
	});

	it('detects [[name|alias]] wikilink', async () => {
		await writeNote('target.md', '# Target');
		await writeNote('source.md', 'See [[target|alias]] for more.');
		const bl = await backlinks('target.md', vaultRoot);
		expect(bl.map((b) => b.path)).toContain('source.md');
	});

	it('detects [[name#heading]] wikilink', async () => {
		await writeNote('target.md', '# Target');
		await writeNote('source.md', 'See [[target#section]] for more.');
		const bl = await backlinks('target.md', vaultRoot);
		expect(bl.map((b) => b.path)).toContain('source.md');
	});

	it('does not count the note itself as a backlink', async () => {
		await writeNote('self.md', 'See [[self]] for more.');
		const bl = await backlinks('self.md', vaultRoot);
		expect(bl.map((b) => b.path)).not.toContain('self.md');
	});

	it('is case-insensitive', async () => {
		await writeNote('target.md', '# Target');
		await writeNote('source.md', 'See [[TARGET]] for more.');
		const bl = await backlinks('target.md', vaultRoot);
		expect(bl.map((b) => b.path)).toContain('source.md');
	});

	it('ignores .obsidian/ directory', async () => {
		await writeNote('target.md', '# Target');
		// Place a linker inside .obsidian/
		const obsidianDir = join(vaultRoot, '.obsidian');
		await fs.mkdir(obsidianDir, { recursive: true });
		await fs.writeFile(join(obsidianDir, 'config.md'), 'See [[target]]', 'utf8');
		const bl = await backlinks('target.md', vaultRoot);
		expect(bl.map((b) => b.path)).not.toContain('.obsidian/config.md');
	});

	it('returns name without .md extension', async () => {
		await writeNote('notes/target.md', '# Target');
		await writeNote('source.md', 'See [[target]] here.');
		const bl = await backlinks('notes/target.md', vaultRoot);
		const found = bl.find((b) => b.path === 'source.md');
		expect(found).toBeDefined();
		expect(found!.name).toBe('source');
	});
});

// ---------------------------------------------------------------------------
// listUnaudited
// ---------------------------------------------------------------------------

describe('listUnaudited', () => {
	it('returns .md files not in audit', async () => {
		await writeNote('a.md', 'A');
		await writeNote('b.md', 'B');
		const audit = makeAudit([{ path: 'a.md' }]);
		await writeAudit(audit);
		const result = await listUnaudited(audit, vaultRoot);
		expect(result).toContain('b.md');
		expect(result).not.toContain('a.md');
	});

	it('ignores index files (index.md, MEMORY.md)', async () => {
		await writeNote('a.md', 'A');
		await writeNote('index.md', 'I');
		await writeNote('claude-memory/p1/MEMORY.md', 'M');
		const audit = makeAudit([{ path: 'a.md' }]);
		expect(await listUnaudited(audit, vaultRoot)).toEqual([]);
	});

	it('ignores .obsidian/ directory', async () => {
		await writeNote('a.md', 'A');
		const obsidianDir = join(vaultRoot, '.obsidian');
		await fs.mkdir(obsidianDir, { recursive: true });
		await fs.writeFile(join(obsidianDir, 'config.md'), 'config', 'utf8');
		const audit = makeAudit([{ path: 'a.md' }]);
		const result = await listUnaudited(audit, vaultRoot);
		expect(result.some((p) => p.includes('.obsidian'))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------

describe('deleteNote', () => {
	it('deletes the file', async () => {
		await writeNote('notes/foo.md', 'content');
		await writeNote('index.md', '- [[foo]]\n- other line\n');
		const audit = makeAudit([{ path: 'notes/foo.md' }, { path: 'index.md' }]);
		await writeAudit(audit);

		await deleteNote('notes/foo.md', vaultRoot, auditFile);

		await expect(fs.access(join(vaultRoot, 'notes/foo.md'))).rejects.toThrow();
	});

	it('removes matching lines from index.md', async () => {
		await writeNote('notes/foo.md', 'content');
		await writeNote('index.md', '- [[foo]]\n- keep this line\n- [[foo|alias]]\n');
		const audit = makeAudit([{ path: 'notes/foo.md' }, { path: 'index.md' }]);
		await writeAudit(audit);

		const result = await deleteNote('notes/foo.md', vaultRoot, auditFile);
		expect(result.indexLinesRemoved).toBe(2);

		const indexContent = await fs.readFile(join(vaultRoot, 'index.md'), 'utf8');
		expect(indexContent).toContain('keep this line');
		expect(indexContent).not.toContain('[[foo]]');
		expect(indexContent).not.toContain('[[foo|alias]]');
	});

	it('leaves other index.md lines intact', async () => {
		await writeNote('notes/foo.md', 'content');
		await writeNote('notes/bar.md', 'bar');
		await writeNote('index.md', '- [[foo]]\n- [[bar]]\n- plain text\n');
		const audit = makeAudit([
			{ path: 'notes/foo.md' },
			{ path: 'notes/bar.md' },
			{ path: 'index.md' }
		]);
		await writeAudit(audit);

		await deleteNote('notes/foo.md', vaultRoot, auditFile);
		const indexContent = await fs.readFile(join(vaultRoot, 'index.md'), 'utf8');
		expect(indexContent).toContain('[[bar]]');
		expect(indexContent).toContain('plain text');
	});

	it('removes item from audit', async () => {
		await writeNote('notes/foo.md', 'content');
		await writeNote('index.md', '');
		const audit = makeAudit([{ path: 'notes/foo.md' }, { path: 'index.md' }]);
		await writeAudit(audit);

		await deleteNote('notes/foo.md', vaultRoot, auditFile);

		const { readAudit: ra } = await import('./audit.js');
		const updated = await ra(auditFile);
		expect(updated.items.find((it) => it.path === 'notes/foo.md')).toBeUndefined();
	});

	it('reports brokenLinksIn (excluding index.md)', async () => {
		await writeNote('notes/foo.md', 'content');
		await writeNote('notes/ref.md', 'See [[foo]] here.');
		await writeNote('index.md', '- [[foo]]\n');
		const audit = makeAudit([
			{ path: 'notes/foo.md' },
			{ path: 'notes/ref.md' },
			{ path: 'index.md' }
		]);
		await writeAudit(audit);

		const result = await deleteNote('notes/foo.md', vaultRoot, auditFile);
		expect(result.brokenLinksIn).toContain('notes/ref.md');
		expect(result.brokenLinksIn).not.toContain('index.md');
	});

	it('returns correct deleted path', async () => {
		await writeNote('notes/foo.md', 'content');
		await writeNote('index.md', '');
		const audit = makeAudit([{ path: 'notes/foo.md' }, { path: 'index.md' }]);
		await writeAudit(audit);

		const result = await deleteNote('notes/foo.md', vaultRoot, auditFile);
		expect(result.deleted).toBe('notes/foo.md');
	});

	it('does not error when deleting a second time (already deleted)', async () => {
		await writeNote('notes/foo.md', 'content');
		await writeNote('index.md', '- [[foo]]\n');
		const audit = makeAudit([{ path: 'notes/foo.md' }, { path: 'index.md' }]);
		await writeAudit(audit);

		await deleteNote('notes/foo.md', vaultRoot, auditFile);

		// Restore the audit item so the second deleteNote can find it in audit
		const restoredAudit = makeAudit([{ path: 'notes/foo.md' }, { path: 'index.md' }]);
		await writeAudit(restoredAudit);

		// Second delete should not throw
		await expect(deleteNote('notes/foo.md', vaultRoot, auditFile)).resolves.toBeDefined();
	});

	it('rejects symlink outside vault even in deleteNote', async () => {
		const outsideFile = join(tmpDir, 'outsider.md');
		await fs.writeFile(outsideFile, 'secret', 'utf8');
		await fs.symlink(outsideFile, join(vaultRoot, 'evil.md'));
		const audit = makeAudit([{ path: 'evil.md' }]);
		await writeAudit(audit);

		await expect(deleteNote('evil.md', vaultRoot, auditFile)).rejects.toThrow(/symlink|outside/i);
		// Confirm the target file still exists (not deleted)
		await expect(fs.access(outsideFile)).resolves.toBeUndefined();
	});

	it('cleans markdown pointer from MEMORY.md in same project folder and leaves other projects intact', async () => {
		await writeNote('claude-memory/p1/a.md', '# Memory Note A');
		await writeNote('claude-memory/p1/b.md', '# Memory Note B');
		await writeNote(
			'claude-memory/p1/MEMORY.md',
			'# Project 1 Memory\n- [a](a.md) — catatan a\n- [b](b.md) — catatan b\n'
		);
		await writeNote(
			'claude-memory/p2/MEMORY.md',
			'# Project 2 Memory\n- [a](a.md) — catatan a in p2\n'
		);
		await writeNote('index.md', '- [[a]]\n');
		const audit = makeAudit([
			{ path: 'claude-memory/p1/a.md' },
			{ path: 'claude-memory/p1/b.md' },
			{ path: 'claude-memory/p1/MEMORY.md' },
			{ path: 'claude-memory/p2/MEMORY.md' },
			{ path: 'index.md' }
		]);
		await writeAudit(audit);

		await deleteNote('claude-memory/p1/a.md', vaultRoot, auditFile);

		const p1Memory = await fs.readFile(join(vaultRoot, 'claude-memory/p1/MEMORY.md'), 'utf8');
		expect(p1Memory).not.toContain('](a.md)');
		expect(p1Memory).toContain('- [b](b.md) — catatan b');
		expect(p1Memory).toContain('# Project 1 Memory');

		const p2Memory = await fs.readFile(join(vaultRoot, 'claude-memory/p2/MEMORY.md'), 'utf8');
		expect(p2Memory).toContain('- [a](a.md) — catatan a in p2');
	});

	it('removes variant ](./a.md) but keeps exact-name mismatches like ](ab.md) and ](xa.md)', async () => {
		await writeNote('claude-memory/p1/a.md', '# A');
		await writeNote(
			'claude-memory/p1/MEMORY.md',
			'- [a](./a.md) — variant dot slash\n- [ab](ab.md) — ab note\n- [xa](xa.md) — xa note\n- [keep](keep.md) — keep this\n'
		);
		const audit = makeAudit([
			{ path: 'claude-memory/p1/a.md' },
			{ path: 'claude-memory/p1/MEMORY.md' }
		]);
		await writeAudit(audit);

		await deleteNote('claude-memory/p1/a.md', vaultRoot, auditFile);

		const content = await fs.readFile(join(vaultRoot, 'claude-memory/p1/MEMORY.md'), 'utf8');
		expect(content).not.toContain('](./a.md)');
		expect(content).toContain('- [ab](ab.md) — ab note');
		expect(content).toContain('- [xa](xa.md) — xa note');
		expect(content).toContain('- [keep](keep.md) — keep this');
	});

	it('does not trigger reading MEMORY.md for non-memory notes', async () => {
		await writeNote('projects/x.md', '# Project X');
		await writeNote('index.md', '- [[x]]\n');
		const audit = makeAudit([{ path: 'projects/x.md' }, { path: 'index.md' }]);
		await writeAudit(audit);

		const readFileSpy = vi.spyOn(fs, 'readFile');

		try {
			await deleteNote('projects/x.md', vaultRoot, auditFile);

			const readPaths = readFileSpy.mock.calls.map((call) => String(call[0]));
			const readMemory = readPaths.some((p) => p.endsWith('MEMORY.md') || p.includes('MEMORY.md'));
			expect(readMemory).toBe(false);
		} finally {
			readFileSpy.mockRestore();
		}
	});

	it('sums removed lines from both index.md and MEMORY.md into indexLinesRemoved', async () => {
		await writeNote('claude-memory/p1/a.md', '# A');
		await writeNote('index.md', '- [[a]]\n- [[a|alias]]\n- keep line in index\n');
		await writeNote(
			'claude-memory/p1/MEMORY.md',
			'- [a](a.md) — standard link\n- [a](./a.md) — dot-slash link\n- keep line in memory\n'
		);
		const audit = makeAudit([
			{ path: 'claude-memory/p1/a.md' },
			{ path: 'index.md' },
			{ path: 'claude-memory/p1/MEMORY.md' }
		]);
		await writeAudit(audit);

		const result = await deleteNote('claude-memory/p1/a.md', vaultRoot, auditFile);
		expect(result.indexLinesRemoved).toBe(4); // 2 from index.md + 2 from MEMORY.md

		const indexContent = await fs.readFile(join(vaultRoot, 'index.md'), 'utf8');
		expect(indexContent).toBe('- keep line in index\n');

		const memoryContent = await fs.readFile(join(vaultRoot, 'claude-memory/p1/MEMORY.md'), 'utf8');
		expect(memoryContent).toBe('- keep line in memory\n');
	});

	it('does not error when deleting a memory note a second time', async () => {
		await writeNote('claude-memory/p1/a.md', '# A');
		await writeNote('claude-memory/p1/MEMORY.md', '- [a](a.md) — desc\n');
		const audit = makeAudit([
			{ path: 'claude-memory/p1/a.md' },
			{ path: 'claude-memory/p1/MEMORY.md' }
		]);
		await writeAudit(audit);

		const firstResult = await deleteNote('claude-memory/p1/a.md', vaultRoot, auditFile);
		expect(firstResult.indexLinesRemoved).toBe(1);

		// Restore audit item so second delete passes resolveSafe
		await writeAudit(audit);

		const secondResult = await deleteNote('claude-memory/p1/a.md', vaultRoot, auditFile);
		expect(secondResult.indexLinesRemoved).toBe(0);
	});

	it('does not process MEMORY.md when deleting MEMORY.md itself', async () => {
		await writeNote('claude-memory/p1/MEMORY.md', '# Memory file\n- [a](a.md)\n');
		const audit = makeAudit([{ path: 'claude-memory/p1/MEMORY.md' }]);
		await writeAudit(audit);

		const result = await deleteNote('claude-memory/p1/MEMORY.md', vaultRoot, auditFile);
		expect(result.deleted).toBe('claude-memory/p1/MEMORY.md');
		await expect(fs.access(join(vaultRoot, 'claude-memory/p1/MEMORY.md'))).rejects.toThrow();
	});

	it('preserves trailing newline or absence of trailing newline in MEMORY.md', async () => {
		// With trailing newline
		await writeNote('claude-memory/p1/a.md', '# A');
		await writeNote('claude-memory/p1/MEMORY.md', '- [a](a.md) — a\n- [b](b.md) — b\n');
		const audit1 = makeAudit([
			{ path: 'claude-memory/p1/a.md' },
			{ path: 'claude-memory/p1/MEMORY.md' }
		]);
		await writeAudit(audit1);

		await deleteNote('claude-memory/p1/a.md', vaultRoot, auditFile);
		const contentWithNewline = await fs.readFile(join(vaultRoot, 'claude-memory/p1/MEMORY.md'), 'utf8');
		expect(contentWithNewline).toBe('- [b](b.md) — b\n');

		// Without trailing newline
		await writeNote('claude-memory/p1/c.md', '# C');
		await writeNote('claude-memory/p1/MEMORY.md', '- [c](c.md) — c\n- [d](d.md) — d');
		const audit2 = makeAudit([
			{ path: 'claude-memory/p1/c.md' },
			{ path: 'claude-memory/p1/MEMORY.md' }
		]);
		await writeAudit(audit2);

		await deleteNote('claude-memory/p1/c.md', vaultRoot, auditFile);
		const contentNoNewline = await fs.readFile(join(vaultRoot, 'claude-memory/p1/MEMORY.md'), 'utf8');
		expect(contentNoNewline).toBe('- [d](d.md) — d');
	});
});

// ---------------------------------------------------------------------------
// readNote
// ---------------------------------------------------------------------------

describe('readNote', () => {
	it('returns content, mtime, item, and backlinks', async () => {
		await writeNote('notes/foo.md', '# Foo\nHello world.');
		await writeNote('source.md', 'See [[foo]] here.');
		const audit = makeAudit([{ path: 'notes/foo.md' }, { path: 'source.md' }]);
		await writeAudit(audit);

		const detail = await readNote('notes/foo.md', vaultRoot, auditFile);
		expect(detail.content).toContain('Hello world.');
		expect(detail.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(detail.item.path).toBe('notes/foo.md');
		expect(detail.backlinks.map((b) => b.path)).toContain('source.md');
	});
});
