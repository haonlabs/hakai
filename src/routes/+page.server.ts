/**
 * +page.server.ts – SvelteKit load function and form actions for the main page.
 *
 * Connects lib (audit + vault) to the SvelteKit route layer.
 * Never returns absolute paths or .env contents to the client.
 */

import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types.js';
import { readAudit, markReviewed } from '#lib/audit.js';
import { readNote, listUnaudited, deleteNote } from '#lib/vault.js';
import { applyFilters } from '#lib/filter.js';
import type { AuditItem, DeleteResult } from '#lib/types.js';

const STALE_DAYS = 14;

function isStale(generatedAt: string): boolean {
	const generated = new Date(generatedAt).getTime();
	const now = Date.now();
	const diffDays = (now - generated) / (1000 * 60 * 60 * 24);
	return diffDays > STALE_DAYS;
}

/** Strip absolute paths from an error message before sending to client.
 * Only replaces paths that start with '/' at the beginning of the string
 * or are preceded by whitespace, a quote, or an opening parenthesis.
 * Relative paths like "inbox/foo.md" are left intact.
 */
function sanitizeError(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	// Match: start-of-string OR (space | " | ' | () followed by /path
	return msg.replace(/(^|[\s"('`])(\/[^\s"')]+)/g, '$1[path]');
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export const load: PageServerLoad = async ({ url }) => {
	const audit = await readAudit();

	// Counts (over ALL items, before filter)
	const unreviewed = audit.items.filter((it) => it.reviewed === null).length;
	const counts = {
		all: audit.items.length,
		usang: audit.items.filter((it) => it.verdict === 'usang').length,
		duplikat: audit.items.filter((it) => it.verdict === 'duplikat').length,
		keep: audit.items.filter((it) => it.verdict === 'keep').length,
		unreviewed
	};

	// Stale + unaudited
	const stale = isStale(audit.generatedAt);
	const unauditedList = await listUnaudited(audit);
	const unaudited = unauditedList.length;

	// Apply filters from query params
	const params = {
		verdict: url.searchParams.get('verdict') ?? undefined,
		source: url.searchParams.get('source') ?? undefined,
		q: url.searchParams.get('q') ?? undefined,
		hideReviewed: url.searchParams.get('hideReviewed') ?? '1'
	};
	const items: AuditItem[] = applyFilters(audit.items, params);

	// Detail panel (note query param)
	const noteParam = url.searchParams.get('note');
	let detail = null;
	let detailError: string | null = null;

	if (noteParam) {
		try {
			detail = await readNote(noteParam);
		} catch (err) {
			detail = null;
			detailError = sanitizeError(err);
		}
	}

	return {
		audit: {
			generatedAt: audit.generatedAt,
			stale,
			unaudited
		},
		counts,
		items,
		detail,
		detailError
	};
};

// ---------------------------------------------------------------------------
// Form Actions
// ---------------------------------------------------------------------------

export const actions: Actions = {
	/**
	 * ?/keep – mark a single note as reviewed.
	 * Field: path (string)
	 */
	keep: async ({ request }) => {
		const data = await request.formData();
		const path = data.get('path');

		if (!path || typeof path !== 'string' || !path.trim()) {
			return fail(400, { message: 'Missing required field: path' });
		}

		try {
			await markReviewed(path.trim());
		} catch (err) {
			return fail(400, { message: sanitizeError(err) });
		}

		return { kept: path.trim() };
	},

	/**
	 * ?/delete – permanently delete a note from the vault.
	 * Field: path (string)
	 */
	delete: async ({ request }) => {
		const data = await request.formData();
		const path = data.get('path');

		if (!path || typeof path !== 'string' || !path.trim()) {
			return fail(400, { message: 'Missing required field: path' });
		}

		let result: DeleteResult;
		try {
			result = await deleteNote(path.trim());
		} catch (err) {
			return fail(400, { message: sanitizeError(err) });
		}

		return result;
	},

	/**
	 * ?/bulk – process multiple notes in one request.
	 * Fields: op ('keep' | 'delete'), paths (repeated)
	 *
	 * Processes sequentially (not in parallel) because audit.json and index.md
	 * use a read-modify-write pattern; parallel writes would lose updates.
	 *
	 * One failure does not abort the rest.
	 */
	bulk: async ({ request }) => {
		const data = await request.formData();
		const op = data.get('op');

		if (!op || (op !== 'keep' && op !== 'delete')) {
			return fail(400, { message: 'Missing or invalid field: op (must be "keep" or "delete")' });
		}

		const paths = data.getAll('paths').filter((p): p is string => typeof p === 'string' && !!p.trim());

		if (paths.length === 0) {
			return fail(400, { message: 'No paths provided for bulk operation' });
		}

		const kept: string[] = [];
		const deleted: string[] = [];
		const failed: Array<{ path: string; message: string }> = [];

		if (op === 'keep') {
			for (const p of paths) {
				try {
					await markReviewed(p.trim());
					kept.push(p.trim());
				} catch (err) {
					failed.push({ path: p.trim(), message: sanitizeError(err) });
				}
			}
		} else {
			// op === 'delete'
			for (const p of paths) {
				try {
					await deleteNote(p.trim());
					deleted.push(p.trim());
				} catch (err) {
					failed.push({ path: p.trim(), message: sanitizeError(err) });
				}
			}
		}

		return { kept, deleted, failed };
	}
};
