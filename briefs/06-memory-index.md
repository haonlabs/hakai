# Brief 06: bersihkan pointer MEMORY.md saat Delete (S)

## Tujuan
Catatan di `claude-memory/<project>/` didaftarkan di `claude-memory/<project>/MEMORY.md` lewat **link Markdown** (`- [judul](nama-file.md) — deskripsi`), bukan wikilink. `deleteNote` sekarang hanya membersihkan `index.md` (wikilink), jadi menghapus memory note meninggalkan baris mati di `MEMORY.md`, padahal file itu dimuat Claude di tiap sesi. Perbaiki di `src/lib/vault.ts`.

## Aturan umum
- Hanya source code dan test. **Tes memakai fixture temp (`fs.mkdtemp`), tidak boleh menyentuh `/Users/haon/Documents/vault`.** Jangan baca/ubah `.env*` atau `audit.json` asli.
- Commit di branch ini, tanpa trailer `Co-authored-by`/`Made-with`/atribusi agent. Laporkan: file + hasil `npm test`, `npm run check`, `npm run build`.

## Boleh disentuh
`src/lib/vault.ts`, `src/lib/vault.test.ts`. Jangan ubah `types.ts`, signature fungsi publik, atau file lain.

## Perilaku
- Di `deleteNote`, setelah menghapus file: selain `index.md`, bersihkan juga `MEMORY.md` **di folder yang sama dengan catatan yang dihapus**, hanya bila `relPath` cocok `^claude-memory/[^/]+/[^/]+\.md$` (jangan sentuh `MEMORY.md` project lain, dan jangan proses bila catatan yang dihapus adalah `MEMORY.md` itu sendiri).
- Satu helper bersama (hindari menyalin logika dua kali) yang membuang baris yang menautkan ke catatan itu, dipakai untuk `index.md` dan `MEMORY.md`. Sebuah baris dianggap menautkan bila memuat **salah satu**: wikilink ke nama file tanpa `.md` (perilaku sekarang, termasuk `[[x|alias]]` dan `[[x#h]]`), atau link Markdown `](nama-file.md)` / `](./nama-file.md)` dengan nama file persis sama (case-sensitive).
- Tulis ulang file atomik (pakai `writeAtomic` yang sudah ada) hanya bila ada baris yang dibuang. File tidak ada → abaikan (ENOENT). Pertahankan baris lain apa adanya, termasuk newline akhir.
- `DeleteResult.indexLinesRemoved` = total baris yang dibuang dari kedua file. `brokenLinksIn` tidak berubah (tetap berbasis `backlinks`, `MEMORY.md` bukan "link rusak" karena ikut dibersihkan).

## Tes (vitest, fixture temp)
- Hapus `claude-memory/p1/a.md`: baris `- [a](a.md) — ...` di `claude-memory/p1/MEMORY.md` hilang, baris lain utuh; `MEMORY.md` milik `p2` yang kebetulan memuat `](a.md)` TIDAK berubah.
- Varian `](./a.md)` terhapus; `](ab.md)` dan `](xa.md)` TIDAK terhapus (nama persis).
- Catatan non-memory (mis. `projects/x.md`) tidak memicu pembacaan `MEMORY.md`.
- `indexLinesRemoved` menghitung baris dari `index.md` + `MEMORY.md`.
- Hapus dua kali tidak error. Semua tes lama tetap lulus.

## Kriteria selesai
`npm test`, `npm run check`, `npm run build` lulus.
