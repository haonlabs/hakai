<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import type { AuditItem, NoteDetail } from '../lib/types';
	type UiData = {
		audit: { generatedAt: string; stale: boolean; unaudited: number };
		counts: { all: number; usang: number; duplikat: number; keep: number; unreviewed: number };
		items: AuditItem[]; detail: NoteDetail | null; detailError: string | null;
	};

	let { data }: { data: UiData } = $props();
	let selected = $state<string[]>([]);
	let notice = $state('');
	let deleteDialog = $state<HTMLDialogElement>();
	let bulkDialog = $state<HTMLDialogElement>();
	let search: HTMLInputElement;
	const renderer = new marked.Renderer();
	renderer.link = ({ href, title, text }) => {
		if (/^wiki:/i.test(href)) return `<span class="wiki-chip">${text}</span>`;
		return `<a href="${href}"${title ? ` title="${title}"` : ''}>${text}</a>`;
	};
	const wikilinkExtension = {
		name: 'wikilink',
		level: 'inline' as const,
		start(src: string) { return src.indexOf('[['); },
		tokenizer(src: string) {
			const match = /^\[\[([^\]]+)\]\]/.exec(src);
			if (!match) return undefined;
			const [target, alias] = match[1].split('|', 2);
			const label = (alias ?? target).split('#', 1)[0].trim();
			return { type: 'link', raw: match[0], href: 'wiki:', title: null, text: label };
		}
	};
	marked.use({ extensions: [wikilinkExtension] });
	let markdown = $derived(data.detail ? DOMPurify.sanitize(marked.parse(data.detail.content, { renderer }) as string, { ADD_ATTR: ['class'] }) : '');
	const params = $derived(new URLSearchParams(page.url.search));
	const verdict = $derived(params.get('verdict') ?? 'unreviewed');
	const sources = $derived((params.get('source') ?? 'vault,memory').split(','));
	const query = $derived(params.get('q') ?? '');
	const hideReviewed = $derived((params.get('hideReviewed') ?? '1') !== '0');
	const checkedItems = $derived(data.items.filter((item) => selected.includes(item.path)));
	let pendingDelete = $state<AuditItem | null>(null);
	let bulkOp = $state<'keep' | 'delete'>('keep');
	let confirmValue = $state('');

	function source(path: string) { return path.startsWith('claude-memory/') ? 'memory' : 'vault'; }
	function name(path: string) { return path.replace(/\.md$/i, '').split('/').at(-1) ?? path; }
	function date(value: string) { return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)); }
	function countsFor(v: string) {
		if (v === 'unreviewed') return data.counts.unreviewed;
		if (v === 'all') return data.counts.all;
		return data.counts[v as keyof typeof data.counts] ?? 0;
	}
	function update(key: string, value: string | null) {
		const next = new URLSearchParams(page.url.search);
		if (value === null || value === '') next.delete(key); else next.set(key, value);
		void goto(`/?${next}`, { reset: false });
	}
	function chooseVerdict(value: string) {
		const next = new URLSearchParams(page.url.search);
		next.set('verdict', value);
		if (value === 'all') next.set('hideReviewed', '0');
		if (value === 'unreviewed') next.set('hideReviewed', '1');
		void goto(`/?${next}`, { reset: false });
	}
	function openNote(path: string) { update('note', path); }
	// Pindah ke baris berikutnya (urutan daftar lama) yang tidak ikut diproses; kosong → lepas pilihan.
	function nextAfterAction(gone: string[]) {
		const at = Math.max(0, data.items.findIndex((item) => item.path === data.detail?.item.path));
		const next = data.items.slice(at).find((item) => !gone.includes(item.path))
			?? data.items.findLast((item) => !gone.includes(item.path));
		update('note', next?.path ?? null);
	}
	function beginDelete(item: AuditItem) { pendingDelete = item; deleteDialog?.showModal(); }
	function showToast(message: string) { notice = message; window.setTimeout(() => notice = '', 4500); }
	function onSubmit(result: any) {
		if (result.type === 'failure') showToast(result.data?.message ?? 'Aksi gagal.');
		else if (result.type === 'success') {
			const resultData = result.data;
			if (resultData?.message) showToast(resultData.message);
			else if (resultData?.failed?.length) showToast(resultData.failed.map((x: any) => x.message).join(' · '));
			else showToast('Perubahan tersimpan.');
			const bulk = Array.isArray(resultData?.kept) || Array.isArray(resultData?.deleted);
			const gone = bulk ? selected : data.detail ? [data.detail.item.path] : [];
			selected = [];
			deleteDialog?.close(); bulkDialog?.close();
			nextAfterAction(gone);
		}
	}
	const enhanced = () => async ({ result, update }: { result: any; update: (options?: { reset?: boolean }) => Promise<void> }) => { onSubmit(result); await update({ reset: false }); };
	function toggleSource(value: string) {
		const next = sources.includes(value) ? sources.filter((x) => x !== value) : [...sources, value];
		update('source', next.length ? next.join(',') : '');
	}
	function shortcut(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement;
		if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
		if (event.key === '/') { event.preventDefault(); search?.focus(); }
		const index = data.items.findIndex((item) => item.path === data.detail?.item.path);
		if (event.key === 'j' || event.key === 'k') {
			event.preventDefault();
			const delta = event.key === 'j' ? 1 : -1;
			const next = data.items[(Math.max(0, index) + delta + data.items.length) % data.items.length];
			if (next) openNote(next.path);
		}
		if (event.key === 'x' && data.detail) selected = selected.includes(data.detail.item.path) ? selected.filter((p) => p !== data.detail!.item.path) : [...selected, data.detail.item.path];
		if (event.key === 'e' && data.detail) (document.getElementById('keep-current') as HTMLFormElement)?.requestSubmit();
		if (event.key === 'd' && data.detail) beginDelete(data.detail.item);
	}
	onMount(() => { window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut); });
</script>

<svelte:head><title>Hakai — Review catatan</title><meta name="description" content="Review audit catatan vault Hakai" /></svelte:head>

<div class="app-shell">
	<aside class="sidebar">
		<a class="brand" href="/" aria-label="Hakai beranda"><span class="brand-mark">破</span><span><strong>Hakai</strong><small>破壊 · Vault audit</small></span></a>
		<section class="side-section"><h2>Verdict</h2>
			{#each [{ key: 'unreviewed', label: 'Belum ditinjau' }, { key: 'usang', label: 'Usang' }, { key: 'duplikat', label: 'Duplikat' }, { key: 'keep', label: 'Keep' }, { key: 'all', label: 'Semua' }] as option}
				<button class:active={verdict === option.key} class="filter-link" onclick={() => chooseVerdict(option.key)}><span>{option.label}</span><small>{countsFor(option.key)}</small></button>
			{/each}
		</section>
		<section class="side-section"><h2>Sumber</h2>
			{#each [{ key: 'vault', label: 'vault' }, { key: 'memory', label: 'claude-memory' }] as option}
				<label class="check-line"><input type="checkbox" checked={sources.includes(option.key)} onchange={() => toggleSource(option.key)} /><span>{option.label}</span></label>
			{/each}
		</section>
		<section class="side-section"><h2>Tampilan</h2><label class="check-line"><input type="checkbox" checked={hideReviewed} onchange={(e) => update('hideReviewed', e.currentTarget.checked ? '1' : '0')} /><span>Sembunyikan ditinjau</span></label></section>
		<div class="shortcuts"><h2>Pintasan</h2><p><kbd>j</kbd> / <kbd>k</kbd><span>Pindah baris</span></p><p><kbd>x</kbd><span>Pilih</span></p><p><kbd>e</kbd><span>Keep</span></p><p><kbd>d</kbd><span>Delete</span></p></div>
	</aside>
	<main class="workspace">
		<header class="topbar"><div><h1>Review catatan</h1><p>Audit {date(data.audit.generatedAt)} · {data.counts.all} catatan · {data.counts.usang} usang · {data.counts.duplikat} duplikat</p></div><label class="search"><span class="sr-only">Cari nama catatan</span><input bind:this={search} value={query} oninput={(e) => update('q', e.currentTarget.value)} placeholder="Cari nama catatan…" /><kbd>/</kbd></label></header>
		{#if data.audit.stale || data.audit.unaudited > 0}<div class="audit-warning"><strong>!</strong> {#if data.audit.stale}Audit sudah {Math.max(0, Math.floor((Date.now() - new Date(data.audit.generatedAt).getTime()) / 86400000))} hari{#if data.audit.unaudited > 0} dan {data.audit.unaudited} file .md belum dinilai{/if}.{:else}{data.audit.unaudited} file .md belum dinilai.{/if} Minta Claude audit ulang.</div>{/if}
		{#if data.detailError}<div class="toast error" role="alert">{data.detailError}</div>{/if}
		<div class="list-area"><div class="table-toolbar"><span>{data.items.length} dari {data.counts.unreviewed} belum ditinjau</span><div><button class="button" disabled={!selected.length} onclick={() => { bulkOp = 'keep'; confirmValue = ''; bulkDialog?.showModal(); }}>Keep terpilih</button><button class="button" disabled={!selected.length} onclick={() => { bulkOp = 'delete'; confirmValue = ''; bulkDialog?.showModal(); }}>Delete terpilih</button></div></div>
			{#if data.items.length}
			<div class="table-wrap"><table><thead><tr><th class="check-col"><span class="sr-only">Pilih</span></th><th>Nama</th><th>Verdict</th><th>Sumber</th><th>Diubah</th><th>Alasan</th></tr></thead><tbody>
			{#each data.items as item (item.path)}<tr class:selected-row={data.detail?.item.path === item.path} onclick={() => openNote(item.path)} onkeydown={(e) => e.key === 'Enter' && openNote(item.path)} tabindex="0">
				<td onclick={(e) => e.stopPropagation()}><input aria-label="Pilih {name(item.path)}" type="checkbox" checked={selected.includes(item.path)} onchange={() => selected = selected.includes(item.path) ? selected.filter((p) => p !== item.path) : [...selected, item.path]} /></td><td class="mono name-cell">{name(item.path)}</td><td><span class="badge {item.verdict}">{item.verdict}</span></td><td class="muted">{source(item.path)}</td><td class="muted">{item.reviewed ? date(item.reviewed) : '—'}</td><td class="reason-cell">{item.reason}</td>
			</tr>{/each}
			</tbody></table></div>
			{:else if data.counts.unreviewed === 0}<div class="empty-state"><span>完</span><h2>Semua sudah ditinjau</h2><p>Tidak ada catatan yang perlu direview saat ini.</p></div>
			{:else}<div class="no-results">Tidak ada catatan yang cocok dengan filter.</div>{/if}
		</div>
		{#if data.detail}
			{@const detail: NoteDetail = data.detail}
			<section class="detail-panel"><div class="detail-heading"><div><h2 class="mono">{name(detail.item.path)}</h2><span class="badge {detail.item.verdict}">{detail.item.verdict}</span></div><div class="detail-actions"><a class="button obsidian" href="obsidian://open?vault=vault&file={encodeURIComponent(detail.item.path.replace(/\.md$/i, ''))}">Buka di Obsidian</a><form id="keep-current" method="POST" action="?/keep" use:enhance={enhanced}><input type="hidden" name="path" value={detail.item.path} /><button class="button">Keep <kbd>e</kbd></button></form><button class="button danger" onclick={() => beginDelete(detail.item)}>Delete <kbd>d</kbd></button></div></div>
				<p class="detail-meta">{detail.item.path} · diubah {date(detail.mtime)} · di-link {detail.backlinks.length} catatan</p>
				<div class="detail-columns"><div><h3>Alasan audit</h3><div class="reason-box">{detail.item.reason}</div><h3>Di-link oleh ({detail.backlinks.length})</h3>{#if detail.backlinks.length}<div class="backlinks">{#each detail.backlinks as backlink}<span class="wiki-chip">[[{name(backlink.path)}]]</span>{/each}</div>{:else}<p class="muted">Tidak ada backlink.</p>{/if}<p class="detail-hint">Delete akan merusak link ini; baris di index.md ikut dihapus.</p></div><div><h3>Isi catatan</h3><article class="markdown" aria-label="Preview Markdown">{@html markdown}</article></div></div>
			</section>
		{/if}
	</main>
</div>

<dialog bind:this={deleteDialog} class="confirm-dialog"><form method="POST" action="?/delete" use:enhance={enhanced}><h2>Hapus catatan ini secara permanen?</h2>{#if pendingDelete}<p class="path-box mono">{pendingDelete.path}</p>{#if data.detail?.backlinks.length}<div class="link-warning"><strong>Masih di-link {data.detail.backlinks.length} catatan</strong><p>{data.detail.backlinks.map((b: { path: string }) => name(b.path)).join(', ')}. Link di catatan kedua akan rusak.</p></div>{/if}<p class="dialog-copy">Tidak bisa dibatalkan. Baris link di index.md ikut dihapus.</p><input type="hidden" name="path" value={pendingDelete.path} />{/if}<div class="dialog-actions"><button type="button" class="button" onclick={() => deleteDialog?.close()}>Batal <kbd>Esc</kbd></button><button class="button danger">Hapus permanen</button></div></form></dialog>

<dialog bind:this={bulkDialog} class="confirm-dialog"><form method="POST" action="?/bulk" use:enhance={enhanced}><h2>{bulkOp === 'delete' ? 'Hapus catatan terpilih?' : 'Keep catatan terpilih?'}</h2><ul class="bulk-paths">{#each checkedItems as item}<li class="mono">{item.path}</li><input type="hidden" name="paths" value={item.path} />{/each}</ul><input type="hidden" name="op" value={bulkOp} />{#if bulkOp === 'delete'}<label class="confirm-count">Ketik {checkedItems.length} untuk mengonfirmasi<input bind:value={confirmValue} inputmode="numeric" /></label>{/if}<div class="dialog-actions"><button type="button" class="button" onclick={() => bulkDialog?.close()}>Batal</button><button class="button" class:danger={bulkOp === 'delete'} disabled={bulkOp === 'delete' && confirmValue !== String(checkedItems.length)}>{bulkOp === 'delete' ? 'Hapus permanen' : 'Keep terpilih'}</button></div></form></dialog>
{#if notice && !bulkDialog?.open}<div class="toast" role="status">{notice}</div>{/if}
