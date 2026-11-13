/**
 * filter.test.ts – unit tests for applyFilters()
 */

import { describe, it, expect } from 'vitest';
import { applyFilters } from './filter.js';
import type { AuditItem } from './types.js';

function item(
	path: string,
	verdict: 'keep' | 'usang' | 'duplikat' = 'keep',
	reviewed: string | null = null
): AuditItem {
	return { path, verdict, reason: 'test', reviewed };
}

const ITEMS: AuditItem[] = [
	item('notes/alpha.md', 'keep', null),
	item('notes/beta.md', 'usang', null),
	item('notes/gamma.md', 'duplikat', null),
	item('notes/delta.md', 'keep', '2026-11-01'),
	item('claude-memory/project/mem.md', 'keep', null),
	item('archive/old.md', 'usang', '2026-10-01'),
];

// ---------------------------------------------------------------------------
// No filters
// ---------------------------------------------------------------------------

describe('applyFilters – no filter params', () => {
	it('returns only unreviewed items by default (hideReviewed=1)', () => {
		const result = applyFilters(ITEMS, {});
		// reviewed items: notes/delta.md, archive/old.md
		expect(result.some((i) => i.path === 'notes/delta.md')).toBe(false);
		expect(result.some((i) => i.path === 'archive/old.md')).toBe(false);
	});

	it('includes all items when hideReviewed=0', () => {
		const result = applyFilters(ITEMS, { hideReviewed: '0' });
		expect(result).toHaveLength(ITEMS.length);
	});
});

// ---------------------------------------------------------------------------
// verdict filter
// ---------------------------------------------------------------------------

describe('applyFilters – verdict filter', () => {
	it('filters by verdict=usang', () => {
		const result = applyFilters(ITEMS, { verdict: 'usang', hideReviewed: '0' });
		expect(result.every((i) => i.verdict === 'usang')).toBe(true);
		expect(result).toHaveLength(2);
	});

	it('filters by verdict=keep', () => {
		const result = applyFilters(ITEMS, { verdict: 'keep', hideReviewed: '0' });
		expect(result.every((i) => i.verdict === 'keep')).toBe(true);
	});

	it('filters by verdict=duplikat', () => {
		const result = applyFilters(ITEMS, { verdict: 'duplikat', hideReviewed: '0' });
		expect(result.every((i) => i.verdict === 'duplikat')).toBe(true);
		expect(result).toHaveLength(1);
	});

	it('returns empty list for unknown verdict', () => {
		const result = applyFilters(ITEMS, { verdict: 'unknown', hideReviewed: '0' });
		expect(result).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// source filter
// ---------------------------------------------------------------------------

describe('applyFilters – source filter', () => {
	it('filters by source=memory', () => {
		const result = applyFilters(ITEMS, { source: 'memory', hideReviewed: '0' });
		expect(result.every((i) => i.path.startsWith('claude-memory/'))).toBe(true);
		expect(result).toHaveLength(1);
	});

	it('filters by source=vault', () => {
		const result = applyFilters(ITEMS, { source: 'vault', hideReviewed: '0' });
		expect(result.every((i) => !i.path.startsWith('claude-memory/'))).toBe(true);
	});

	it('allows comma-separated: source=vault,memory returns all', () => {
		const all = applyFilters(ITEMS, { hideReviewed: '0' });
		const result = applyFilters(ITEMS, { source: 'vault,memory', hideReviewed: '0' });
		expect(result).toHaveLength(all.length);
	});

	it('no source param → no source filter', () => {
		const result = applyFilters(ITEMS, { hideReviewed: '0' });
		expect(result).toHaveLength(ITEMS.length);
	});
});

// ---------------------------------------------------------------------------
// q filter
// ---------------------------------------------------------------------------

describe('applyFilters – q (search) filter', () => {
	it('filters by substring of path (case-insensitive)', () => {
		const result = applyFilters(ITEMS, { q: 'ALPHA', hideReviewed: '0' });
		expect(result).toHaveLength(1);
		expect(result[0].path).toBe('notes/alpha.md');
	});

	it('matches partial path segments', () => {
		const result = applyFilters(ITEMS, { q: 'notes/', hideReviewed: '0' });
		expect(result.every((i) => i.path.startsWith('notes/'))).toBe(true);
	});

	it('returns empty list when q matches nothing', () => {
		const result = applyFilters(ITEMS, { q: 'zzznomatch', hideReviewed: '0' });
		expect(result).toHaveLength(0);
	});

	it('no q param → no q filter', () => {
		const result = applyFilters(ITEMS, { hideReviewed: '0' });
		expect(result).toHaveLength(ITEMS.length);
	});
});

// ---------------------------------------------------------------------------
// hideReviewed filter
// ---------------------------------------------------------------------------

describe('applyFilters – hideReviewed filter', () => {
	it('hides reviewed items by default (no param)', () => {
		const result = applyFilters(ITEMS, {});
		expect(result.every((i) => i.reviewed === null)).toBe(true);
	});

	it('hides reviewed items when hideReviewed=1', () => {
		const result = applyFilters(ITEMS, { hideReviewed: '1' });
		expect(result.every((i) => i.reviewed === null)).toBe(true);
	});

	it('shows all items when hideReviewed=0', () => {
		const result = applyFilters(ITEMS, { hideReviewed: '0' });
		expect(result.some((i) => i.reviewed !== null)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Sort order
// ---------------------------------------------------------------------------

describe('applyFilters – sort order', () => {
	it('sorts usang before duplikat before keep', () => {
		const mixed = [
			item('c.md', 'keep'),
			item('a.md', 'duplikat'),
			item('b.md', 'usang'),
		];
		const result = applyFilters(mixed, { hideReviewed: '0' });
		expect(result[0].verdict).toBe('usang');
		expect(result[1].verdict).toBe('duplikat');
		expect(result[2].verdict).toBe('keep');
	});

	it('sorts alphabetically by path within the same verdict', () => {
		const mixed = [
			item('notes/z.md', 'keep'),
			item('notes/a.md', 'keep'),
			item('notes/m.md', 'keep'),
		];
		const result = applyFilters(mixed, { hideReviewed: '0' });
		expect(result.map((i) => i.path)).toEqual(['notes/a.md', 'notes/m.md', 'notes/z.md']);
	});

	it('combined: verdict order then path A-Z', () => {
		const mixed = [
			item('z-keep.md', 'keep'),
			item('a-keep.md', 'keep'),
			item('b-usang.md', 'usang'),
			item('a-usang.md', 'usang'),
			item('a-dup.md', 'duplikat'),
		];
		const result = applyFilters(mixed, { hideReviewed: '0' });
		expect(result.map((i) => i.path)).toEqual([
			'a-usang.md',
			'b-usang.md',
			'a-dup.md',
			'a-keep.md',
			'z-keep.md',
		]);
	});
});

// ---------------------------------------------------------------------------
// Combined filters
// ---------------------------------------------------------------------------

describe('applyFilters – combined filters', () => {
	it('verdict + q combined', () => {
		const result = applyFilters(ITEMS, { verdict: 'keep', q: 'notes', hideReviewed: '0' });
		expect(result.every((i) => i.verdict === 'keep' && i.path.includes('notes'))).toBe(true);
	});

	it('source + hideReviewed combined', () => {
		const result = applyFilters(ITEMS, { source: 'vault', hideReviewed: '1' });
		expect(result.every((i) => !i.path.startsWith('claude-memory/') && i.reviewed === null)).toBe(
			true
		);
	});
});
