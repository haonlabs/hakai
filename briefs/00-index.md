# Hakai: indeks brief

Urutan dan dependensi (tag ukuran S/M/L, 13 Nov 2026):

| # | Brief | Ukuran | Bergantung pada | Boleh paralel dengan |
|---|---|---|---|---|
| 01 | scaffold | S | - | - |
| 02 | lib vault + audit + tes | M | 01 | - |
| 03 | server: load + form actions | M | 02 | 04 |
| 04 | UI Svelte (daftar, detail, dialog) | M | 02 (tipe), kontrak di bawah | 03 |
| 05 | e2e (README oleh Claude) | S | 03, 04 | - |

Tiap brief mandiri. Baca `CLAUDE.md`, `docs/PRD.md`, `docs/Design.md` di root project dulu.

## Keputusan yang sudah final
- Delete = hapus file permanen (tanpa archive/trash). Pengaman: konfirmasi di UI + guard path di server.
- Default yang dipakai (belum dikonfirmasi user, ubah bila diminta): banner "audit basi" bila `generatedAt` > 14 hari atau ada `.md` di vault yang tidak ada di `audit.json`; tombol "Buka di Obsidian" (`obsidian://open?vault=vault&file=<path tanpa .md>`) masuk v1.
- Vault: `VAULT_ROOT` dari `.env`. Berisi ±70 file `.md`. `claude-memory/<project>/` adalah direktori nyata di vault (symlink-nya ada di sisi `~/.claude/projects/*/memory`, bukan di vault).

## Kontrak antar modul (jangan diubah tanpa lapor)

`src/lib/types.ts`:
```ts
export type Verdict = 'keep' | 'usang' | 'duplikat';
export interface AuditItem { path: string; verdict: Verdict; reason: string; reviewed: string | null }
export interface Audit { generatedAt: string; vaultRoot: string; items: AuditItem[] }
export interface Backlink { path: string; name: string }
export interface NoteDetail { item: AuditItem; content: string; mtime: string; backlinks: Backlink[] }
export interface DeleteResult { deleted: string; indexLinesRemoved: number; brokenLinksIn: string[] }
```
`path` selalu relatif terhadap `VAULT_ROOT`, pemisah `/`, berekstensi `.md`.

`src/lib/audit.ts`: `readAudit(): Promise<Audit>`, `markReviewed(path: string, today?: Date)`, `removeItem(path: string)`.
`src/lib/vault.ts`: `readNote(path): Promise<NoteDetail>`, `listUnaudited(audit): Promise<string[]>`, `backlinks(path): Promise<Backlink[]>`, `deleteNote(path): Promise<DeleteResult>`.

Route & action (brief 03 membuat, brief 04 memakai):
- `GET /` load → `{ audit: {generatedAt, stale: boolean, unaudited: number}, counts: {all, usang, duplikat, keep, unreviewed}, items: AuditItem[], detail: NoteDetail | null, detailError: string | null }`; query `verdict` (hanya `usang`|`duplikat`|`keep` yang memfilter; nilai lain atau kosong, mis. `unreviewed`/`all` dari UI, = tanpa filter verdict), `source` (`vault`|`memory`, boleh dua-duanya dipisah koma), `q`, `hideReviewed` (`1`/`0`, default `1`), `note` (path catatan terpilih; bila ada dan lolos guard → `detail` terisi; bila ditolak guard/tidak ada → `detail: null` dan `detailError` berisi pesan, halaman tetap 200).
- Tidak ada route `/note/...` (diputuskan 13 Nov 2026: panel detail ada di halaman yang sama, pilihan baris lewat `?note=`).
- Form actions di `/`: `?/keep` (field `path`), `?/delete` (field `path`), `?/bulk` (field `op` = `keep`|`delete`, field `paths` berulang). Hasil `fail(400, {message})` bila ditolak. Hasil sukses: `keep` → `{ kept: string }`, `delete` → `DeleteResult`, `bulk` → `{ kept: string[], deleted: string[], failed: {path, message}[] }` (hanya array sesuai `op` yang berisi).
- Sumber ("source"): `memory` jika path diawali `claude-memory/`, selain itu `vault`.

## Desain visual (ringkas untuk eksekutor tanpa Figma)
Token warna (Light / Dark):
bg/app #F6F3EE / #121214 · bg/surface #FFFFFF / #1B1B1F · bg/subtle #EFEBE4 / #232328 · border/default #DDD6CB / #34343B · border/strong #C4BBAD / #4A4A53 · text/primary #17171A / #ECECEF · text/muted #6B665E / #9A9AA3 · accent/hakai #C8321E / #FF6B55 · accent/on #FFFFFF / #17171A · accent/tint #F7E2DD / #2E1D1B · usang bg/fg #F9E1DC,#9E2414 / #3A1D19,#FF8F7C · duplikat #FBEFCF,#7A5A00 / #3A3014,#E8C25A · keep #DCEFE8,#17604D / #15302A,#6FD6B6 · scrim #17171A / #000000 (opacity 0.5).
Font: Inter (UI), JetBrains Mono (nama/path), Noto Sans JP (破 / 完). Ukuran: title 20/28 semibold, section 14/20 semibold, body 13/20, label 12/16 medium, caption 11/16, mono 12/18.
Tema mengikuti `prefers-color-scheme` lewat CSS variables.
