---
tags: [proyek, design, hakai]
status: draft
---
# Hakai — Design

Status: draf 13 Nov 2026. Kebutuhan: [[hakai-prd]].

## Stack (keputusan)
- **SvelteKit (Svelte 5) + TypeScript + Tailwind**, adapter-node. Lokasi: `~/Documents/workspace/sveltekit_web_project/hakai`.
- Dipilih bukan Next.js (keputusan user 13 Nov 2026: terlalu berat). SvelteKit ringan, dev server cepat, dan form actions / `+page.server.ts` cukup untuk operasi file (Node `fs`). Tanpa database, tanpa auth (localhost saja).
- Render Markdown: `marked` (+ sanitasi dengan `dompurify` atau `isomorphic-dompurify`). Wikilink `[[x]]` dirender sebagai chip non-klik.
- Tanpa library state; data daftar dari `load()` server, aksi lewat form actions + `invalidateAll()`.
- Pintu ke desktop tetap terbuka: UI Svelte bisa dibungkus Tauri nanti, hanya `lib/vault.ts` yang ditulis ulang di Rust.

## Arsitektur
```
Claude ──tulis──▶ audit.json  (di root project, gitignore)
                      │
Browser ◀── SvelteKit ┤  lib/audit.ts   baca/tulis audit.json
   │                  │  lib/vault.ts   baca .md, backlinks, hapus + bersihkan index.md
   └── form action ───┘  guard path: harus di dalam VAULT_ROOT, ekstensi .md, ada di audit.json
```
Config: `.env` → `VAULT_ROOT=/Users/haon/Documents/vault`. Dev: `vite dev --host 127.0.0.1`; pakai: `vite build` lalu `node build` dengan `HOST=127.0.0.1`.

## Modul
| File | Tugas |
|---|---|
| `lib/audit.ts` | `readAudit()`, `markReviewed(path)`, `removeItem(path)`; validasi bentuk JSON |
| `lib/vault.ts` | `readNote(path)`, `backlinks(path)` (scan `[[nama]]` di semua `.md`), `deleteNote(path)` (realpath + guard, hapus file, hapus baris di `index.md` yang memuat `[[nama]]`) |
| `src/routes/+page.svelte` + `+page.server.ts` | Daftar + filter (query: `verdict`, `source`, `q`) |
| `+page.server.ts` (actions) | `keep`, `delete`, `bulk` |
| `lib/components/NoteTable.svelte` | Tabel dengan checkbox (state seleksi di komponen) |
| `lib/components/ConfirmDelete.svelte` | Dialog konfirmasi (`<dialog>` native) |

## Layout (desktop, satu halaman dua panel)
```
┌──────────────────────────────────────────────────────────────────────┐
│ Hakai              audit 13 Nov 10:00 · 118 catatan · 31 usang       │
├───────────────┬──────────────────────────────────────────────────────┤
│ FILTER        │  [search……………………]            [Keep terpilih][Delete…] │
│ ◉ Belum       │ ┌──┬───────────────────────────┬────────┬──────────┐ │
│   ditinjau    │ │☐ │ Nama                      │Verdict │ Sumber   │ │
│ ○ Usang  (31) │ │☐ │ jira-proj-lama            │ usang  │ memory   │ │
│ ○ Duplikat(4) │ │☑ │ lowongan-log-arsip-2026…  │ usang  │ vault    │ │
│ ○ Keep  (83)  │ │☐ │ koneksi-lambat-2026-10-19 │ keep   │ vault    │ │
│ Sumber        │ └──┴───────────────────────────┴────────┴──────────┘ │
│ ☑ vault       ├──────────────────────────────────────────────────────┤
│ ☑ memory      │ DETAIL: jira-proj-lama                               │
│               │ Alasan: Jira ditinggalkan sejak 9 Nov, diganti Mira. │
│               │ Backlinks: index.md, timesheet-dsn-sumber-data (2)   │
│               │ ── isi catatan (Markdown) ──                         │
│               │                          [Keep]   [Delete]           │
└───────────────┴──────────────────────────────────────────────────────┘
```
Mobile tidak jadi target (tool lokal); layout satu kolom saja bila sempit.

## Visual
- Tema mengikuti sistem (light/dark) lewat CSS variables; font sistem; kepadatan tinggi (baris 36 px) karena tujuannya memindai banyak baris.
- Verdict sebagai badge: **usang** = merah redup, **duplikat** = kuning redup, **keep** = abu/hijau redup. Warna tidak jadi satu-satunya penanda (ada teks).
- Delete = tombol merah, hanya satu di panel detail; Keep = tombol netral. Tombol Delete massal baru aktif jika ada yang dipilih.

## Interaksi & state
- Klik baris → detail di panel bawah tabel (URL `/?note=<path>`, bertahan saat refresh; diubah 13 Nov 2026 dari route `/note/...` karena layout satu halaman dua panel).
- Setelah Keep/Delete, otomatis lompat ke baris berikutnya di filter yang sama (alur review cepat). Pintasan: `j/k` navigasi, `x` pilih, `d` Delete, `e` Keep.
- Dialog Delete: tampilkan path penuh, jumlah backlinks (dengan daftar), tombol "Hapus permanen" (merah). Massal: harus mengetik jumlah item untuk mengaktifkan tombol.
- Banner kuning bila `audit.json` lebih lama dari 14 hari atau ada file `.md` di vault yang tidak ada di audit ("N file belum dinilai — minta Claude audit ulang").
- Error (file sudah hilang, path ditolak guard) tampil sebagai toast; baris dihapus dari daftar bila file sudah tidak ada.

## Aturan keamanan di `deleteNote`
1. `realpath(target)` harus diawali `realpath(VAULT_ROOT)` (menangani symlink `claude-memory/`; target symlink yang keluar vault → hapus link saja, bukan file tujuan).
2. Hanya `.md`.
3. Path harus ada di `audit.json`.
4. Setelah hapus: buang baris `index.md` yang memuat `[[nama]]` atau link Markdown `](nama.md)`; untuk catatan di `claude-memory/<project>/` lakukan hal yang sama pada `claude-memory/<project>/MEMORY.md` (pointer memory memakai link Markdown). Tulis ulang atomik (tulis file temp lalu rename). Ditambah 13 Nov 2026 (brief 06).

## Pengujian
- Unit test `lib/vault.ts`: guard path (`../`, symlink keluar, bukan `.md`), backlinks, pembersihan `index.md` (vitest, bawaan SvelteKit; fixture vault kecil di temp dir).
- Satu e2e Playwright: Keep satu catatan, Delete satu catatan pada fixture, cek file hilang dan `index.md` bersih.

## Urutan kerja (tag S/M/L untuk delegasi)
1. **S** Scaffold SvelteKit (`sv create`) + Tailwind, env, `audit.json` contoh.
2. **M** `lib/vault.ts` + `lib/audit.ts` + unit test (eksekutor).
3. **M** Form actions + guard (eksekutor, review oleh Claude).
4. **M** UI: daftar, filter, detail, dialog (desain/UI dikerjakan Claude sendiri sesuai aturan; tidak didelegasikan).
5. **S** e2e + README singkat cara menjalankan.
6. Audit pertama oleh Claude → isi `audit.json` → review bersama.

## Open questions
- Ambang banner "audit basi": 14 hari?
- Perlu tombol "Buka di Obsidian" (`obsidian://open?...`)? Murah dibuat; usul masuk v1.

## UI di Figma (13 Nov 2026)
- File: https://www.figma.com/design/ssh9G7MjV65LY9fsXOCFDd (Hakai - Vault Audit), halaman `Screens` (+ halaman `Tokens` kosong).
- 5 layar 1440×960: 01 Review Light, 02 Review Dark, 03 Delete satu catatan, 04 Delete massal (ketik jumlah), 05 Empty state "Semua sudah ditinjau". Data di layar hanyalah contoh.
- Token: dua koleksi variabel `Hakai Light` / `Hakai Dark` (17 warna; Starter hanya 1 mode per koleksi), 6 text style `Hakai/*`. Aksen merah `accent/hakai` (#C8321E terang, #FF6B55 gelap); hanya dipakai untuk Delete dan item aktif.
- Font: Inter (UI), JetBrains Mono (path/nama catatan), Noto Sans JP (破 / 完).
- Belum ada: komponen Figma formal (layar digenerate lewat kode terikat variabel), state toast/error, prototype klik.
