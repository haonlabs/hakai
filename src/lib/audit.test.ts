/**
 * audit.test.ts – unit tests for src/lib/audit.ts
 *
 * Uses a temp dir for all file operations; never touches the real vault.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { readAudit, markReviewed, removeItem } from './audit.js';
import type { Audit } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let auditFile: string;

async function writeAuditFixture(data: unknown): Promise<void> {
	await fs.writeFile(auditFile, JSON.stringify(data, null, 2), 'utf8');
}

const VALID_AUDIT: Audit = {
	generatedAt: '2026-11-13T03:00:00.000Z',
	vaultRoot: '/tmp/vault',
	items: [
		{ path: 'notes/foo.md', verdict: 'keep', reason: 'active', reviewed: null },
		{ path: 'archive/bar.md', verdict: 'usang', reason: 'old', reviewed: '2026-11-01' }
	]
};

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(join('/tmp', 'hakai-audit-test-'));
	auditFile = join(tmpDir, 'audit.json');
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readAudit
// ---------------------------------------------------------------------------

describe('readAudit', () => {
	it('parses a valid audit file', async () => {
		await writeAuditFixture(VALID_AUDIT);
		const result = await readAudit(auditFile);
		expect(result.generatedAt).toBe(VALID_AUDIT.generatedAt);
		expect(result.items).toHaveLength(2);
		expect(result.items[0].path).toBe('notes/foo.md');
		expect(result.items[1].reviewed).toBe('2026-11-01');
	});

	it('throws on invalid JSON', async () => {
		await fs.writeFile(auditFile, 'NOT JSON{{{', 'utf8');
		await expect(readAudit(auditFile)).rejects.toThrow(/not valid JSON/i);
	});

	it('throws when root is not an object', async () => {
		await writeAuditFixture([1, 2, 3]);
		await expect(readAudit(auditFile)).rejects.toThrow(/root must be a JSON object/i);
	});

	it('throws when generatedAt is missing', async () => {
		await writeAuditFixture({ vaultRoot: '/tmp', items: [] });
		await expect(readAudit(auditFile)).rejects.toThrow(/generatedAt/i);
	});

	it('throws when items is not an array', async () => {
		await writeAuditFixture({ generatedAt: 'x', vaultRoot: '/tmp', items: {} });
		await expect(readAudit(auditFile)).rejects.toThrow(/items/i);
	});

	it('throws when an item has an invalid verdict', async () => {
		await writeAuditFixture({
			...VALID_AUDIT,
			items: [{ path: 'a.md', verdict: 'INVALID', reason: 'x', reviewed: null }]
		});
		await expect(readAudit(auditFile)).rejects.toThrow(/verdict/i);
	});

	it('throws when an item has an absolute path', async () => {
		await writeAuditFixture({
			...VALID_AUDIT,
			items: [{ path: '/absolute/path.md', verdict: 'keep', reason: 'x', reviewed: null }]
		});
		await expect(readAudit(auditFile)).rejects.toThrow(/relative/i);
	});

	it('throws when an item path contains ..', async () => {
		await writeAuditFixture({
			...VALID_AUDIT,
			items: [{ path: '../escape.md', verdict: 'keep', reason: 'x', reviewed: null }]
		});
		await expect(readAudit(auditFile)).rejects.toThrow(/\.\./);
	});

	it('throws when reviewed is neither null nor string', async () => {
		await writeAuditFixture({
			...VALID_AUDIT,
			items: [{ path: 'a.md', verdict: 'keep', reason: 'x', reviewed: 42 }]
		});
		await expect(readAudit(auditFile)).rejects.toThrow(/reviewed/i);
	});

	it('throws when file does not exist', async () => {
		await expect(readAudit(join(tmpDir, 'nonexistent.json'))).rejects.toThrow(/Cannot read/i);
	});
});

// ---------------------------------------------------------------------------
// markReviewed
// ---------------------------------------------------------------------------

describe('markReviewed', () => {
	it('sets reviewed to today ISO date', async () => {
		await writeAuditFixture(VALID_AUDIT);
		const today = new Date('2026-11-13T12:00:00Z');
		await markReviewed('notes/foo.md', today, auditFile);
		const updated = await readAudit(auditFile);
		expect(updated.items[0].reviewed).toBe('2026-11-13');
	});

	it('overwrites an existing reviewed date', async () => {
		await writeAuditFixture(VALID_AUDIT);
		const today = new Date('2026-11-20T00:00:00Z');
		await markReviewed('archive/bar.md', today, auditFile);
		const updated = await readAudit(auditFile);
		expect(updated.items[1].reviewed).toBe('2026-11-20');
	});

	it('writes atomically (file is valid JSON after write)', async () => {
		await writeAuditFixture(VALID_AUDIT);
		await markReviewed('notes/foo.md', new Date(), auditFile);
		const raw = await fs.readFile(auditFile, 'utf8');
		expect(() => JSON.parse(raw)).not.toThrow();
	});

	it('throws when path not found', async () => {
		await writeAuditFixture(VALID_AUDIT);
		await expect(markReviewed('nonexistent.md', new Date(), auditFile)).rejects.toThrow(
			/not found in audit/i
		);
	});
});

// ---------------------------------------------------------------------------
// removeItem
// ---------------------------------------------------------------------------

describe('removeItem', () => {
	it('removes the item from audit', async () => {
		await writeAuditFixture(VALID_AUDIT);
		await removeItem('notes/foo.md', auditFile);
		const updated = await readAudit(auditFile);
		expect(updated.items).toHaveLength(1);
		expect(updated.items[0].path).toBe('archive/bar.md');
	});

	it('is a no-op when path not in audit', async () => {
		await writeAuditFixture(VALID_AUDIT);
		await removeItem('ghost.md', auditFile);
		const updated = await readAudit(auditFile);
		expect(updated.items).toHaveLength(2);
	});

	it('writes atomically (file is valid JSON after write)', async () => {
		await writeAuditFixture(VALID_AUDIT);
		await removeItem('archive/bar.md', auditFile);
		const raw = await fs.readFile(auditFile, 'utf8');
		expect(() => JSON.parse(raw)).not.toThrow();
	});
});
