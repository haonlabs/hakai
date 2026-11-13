/**
 * audit.ts – read/write the audit JSON file atomically.
 *
 * All writes go through writeAtomic: write to a sibling temp file,
 * then fs.rename (atomic on POSIX).
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getAuditFile } from './config.js';
import type { Audit, AuditItem, Verdict } from './types.js';

const VERDICTS: Verdict[] = ['keep', 'usang', 'duplikat'];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertValidPath(p: string): void {
	if (!p || typeof p !== 'string') {
		throw new Error(`Invalid audit item path: ${JSON.stringify(p)}`);
	}
	if (/^\//.test(p)) {
		throw new Error(`Audit item path must be relative, got: "${p}"`);
	}
	if (p.split('/').some((seg) => seg === '..')) {
		throw new Error(`Audit item path must not contain "..": "${p}"`);
	}
}

function validateAudit(raw: unknown): Audit {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error('audit.json: root must be a JSON object');
	}
	const obj = raw as Record<string, unknown>;

	if (typeof obj.generatedAt !== 'string') {
		throw new Error('audit.json: "generatedAt" must be a string');
	}
	if (typeof obj.vaultRoot !== 'string') {
		throw new Error('audit.json: "vaultRoot" must be a string');
	}
	if (!Array.isArray(obj.items)) {
		throw new Error('audit.json: "items" must be an array');
	}

	const items: AuditItem[] = obj.items.map((item: unknown, idx: number) => {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) {
			throw new Error(`audit.json items[${idx}]: must be an object`);
		}
		const it = item as Record<string, unknown>;

		if (typeof it.path !== 'string') {
			throw new Error(`audit.json items[${idx}]: "path" must be a string`);
		}
		assertValidPath(it.path as string);

		if (!VERDICTS.includes(it.verdict as Verdict)) {
			throw new Error(
				`audit.json items[${idx}]: "verdict" must be one of ${VERDICTS.join(', ')}, ` +
					`got ${JSON.stringify(it.verdict)}`
			);
		}
		if (typeof it.reason !== 'string') {
			throw new Error(`audit.json items[${idx}]: "reason" must be a string`);
		}
		if (it.reviewed !== null && typeof it.reviewed !== 'string') {
			throw new Error(`audit.json items[${idx}]: "reviewed" must be null or a string`);
		}

		return {
			path: it.path as string,
			verdict: it.verdict as Verdict,
			reason: it.reason as string,
			reviewed: (it.reviewed ?? null) as string | null
		};
	});

	return {
		generatedAt: obj.generatedAt as string,
		vaultRoot: obj.vaultRoot as string,
		items
	};
}

async function writeAtomic(filePath: string, data: string): Promise<void> {
	const dir = dirname(filePath);
	const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
	try {
		await fs.writeFile(tmp, data, 'utf8');
		await fs.rename(tmp, filePath);
	} catch (err) {
		// Clean up temp file on failure (best-effort)
		await fs.unlink(tmp).catch(() => undefined);
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function readAudit(filePath?: string): Promise<Audit> {
	const path = filePath ?? getAuditFile();
	let raw: string;
	try {
		raw = await fs.readFile(path, 'utf8');
	} catch (err: unknown) {
		const e = err as NodeJS.ErrnoException;
		throw new Error(`Cannot read audit file "${path}": ${e.message}`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`audit.json at "${path}" is not valid JSON`);
	}

	return validateAudit(parsed);
}

export async function markReviewed(itemPath: string, today?: Date, filePath?: string): Promise<void> {
	const auditFile = filePath ?? getAuditFile();
	const audit = await readAudit(auditFile);
	const dateStr = (today ?? new Date()).toISOString().slice(0, 10);

	const idx = audit.items.findIndex((it) => it.path === itemPath);
	if (idx === -1) {
		throw new Error(`markReviewed: path "${itemPath}" not found in audit`);
	}
	audit.items[idx].reviewed = dateStr;

	await writeAtomic(auditFile, JSON.stringify(audit, null, 2) + '\n');
}

export async function removeItem(itemPath: string, filePath?: string): Promise<void> {
	const auditFile = filePath ?? getAuditFile();
	const audit = await readAudit(auditFile);
	audit.items = audit.items.filter((it) => it.path !== itemPath);
	await writeAtomic(auditFile, JSON.stringify(audit, null, 2) + '\n');
}
