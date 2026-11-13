/**
 * filter.ts – pure functions for filtering and sorting AuditItems.
 *
 * No I/O, no side effects. All params come from URLSearchParams or similar.
 */

import type { AuditItem, Verdict } from './types.js';

const VERDICT_ORDER: Record<Verdict, number> = { usang: 0, duplikat: 1, keep: 2 };

/** Determine source category from a relative path. */
function getSource(path: string): 'memory' | 'vault' {
	return path.startsWith('claude-memory/') ? 'memory' : 'vault';
}

export interface FilterParams {
	/** Filter by verdict (single value). */
	verdict?: string;
	/**
	 * Filter by source: `vault`, `memory`, or comma-separated e.g. `vault,memory`.
	 * Absent → no filter.
	 */
	source?: string;
	/** Case-insensitive substring filter on path. */
	q?: string;
	/**
	 * Hide items that have been reviewed (`reviewed !== null`).
	 * Defaults to `'1'` (hide reviewed). Pass `'0'` to show all.
	 */
	hideReviewed?: string;
}

/**
 * Apply filters and sort to a list of AuditItems.
 *
 * Sort order: usang → duplikat → keep, then path A–Z within each group.
 */
export function applyFilters(items: AuditItem[], params: FilterParams): AuditItem[] {
	const { verdict, source, q, hideReviewed = '1' } = params;

	// Build allowed source set
	let allowedSources: Set<string> | null = null;
	if (source) {
		allowedSources = new Set(source.split(',').map((s) => s.trim()).filter(Boolean));
	}

	const qLower = q ? q.toLowerCase() : null;

	let result = items.filter((item) => {
		// verdict filter
		if (verdict && item.verdict !== verdict) return false;

		// source filter
		if (allowedSources !== null) {
			const itemSource = getSource(item.path);
			if (!allowedSources.has(itemSource)) return false;
		}

		// q filter: case-insensitive substring on path
		if (qLower && !item.path.toLowerCase().includes(qLower)) return false;

		// hideReviewed filter (default '1' = hide reviewed items)
		if (hideReviewed !== '0' && item.reviewed !== null) return false;

		return true;
	});

	// Sort: verdict order, then path A-Z
	result = result.slice().sort((a, b) => {
		const vo = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
		if (vo !== 0) return vo;
		return a.path.localeCompare(b.path);
	});

	return result;
}
