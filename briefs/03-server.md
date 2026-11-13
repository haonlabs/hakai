# Brief 03: server load + form actions (M)

## Tujuan
Menghubungkan lib ke SvelteKit: `load` dan form actions sesuai kontrak di `briefs/00-index.md`. Tidak ada UI di brief ini (itu brief 04, berjalan paralel; jangan sentuh `.svelte`).

## Aturan umum
- Hanya source code/test. Tes memakai fixture temp, tidak menyentuh vault asli. Commit tanpa trailer agent. Laporkan: file + hasil `npm test` dan `npm run build`.

## Boleh disentuh
`src/routes/+page.server.ts`, `src/lib/filter.ts` (baru, fungsi murni), `src/lib/filter.test.ts`, `src/routes/page.server.test.ts` (opsional). Jangan ubah `src/lib/vault.ts`/`audit.ts` selain bug yang dilaporkan.

## Perilaku
- `/` load: baca audit, hitung `counts` (`unreviewed` = item dengan `reviewed === null`), `stale` = `generatedAt` lebih dari 14 hari, `unaudited` = `listUnaudited(audit).length`. Terapkan filter query (`verdict`, `source`, `q` = substring case-insensitive di path, `hideReviewed` default `1`) lewat fungsi murni `applyFilters(items, params)` di `filter.ts`. Urut: `usang`, `duplikat`, `keep`, lalu path A–Z.
- Query `note`: bila ada, panggil `readNote` → `detail`; bila guard menolak/file tidak ada → `detail: null`, `detailError: <pesan singkat tanpa path absolut>`; jangan `error(404)` (halaman daftar harus tetap tampil). Tanpa `note` → `detail: null, detailError: null`.
- Actions `keep`, `delete`, `bulk`: validasi input, panggil lib, `fail(400, { message })` bila guard menolak. Bentuk hasil sukses ada di kontrak `briefs/00-index.md`. `bulk` memproses semua path (`op=keep` → `markReviewed`, `op=delete` → `deleteNote`); satu kegagalan tidak membatalkan yang lain. Proses **berurutan** (`for ... await`), bukan `Promise.all`: `audit.json` dan `index.md` ditulis dengan pola baca-ubah-tulis, jadi paralel menghilangkan update.
- Jangan pernah mengembalikan path absolut atau isi `.env` ke klien.

## Kriteria selesai
`npm test` dan `npm run build` lulus; `applyFilters` teruji untuk setiap query param.
