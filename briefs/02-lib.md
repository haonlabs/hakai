# Brief 02: lib vault + audit + tes (M)

## Tujuan
Implementasi `src/lib/audit.ts` dan `src/lib/vault.ts` sesuai kontrak di `briefs/00-index.md`, plus unit test. Ini satu-satunya kode yang menyentuh filesystem; semua guard keamanan ada di sini.

## Aturan umum
- Hanya source code dan test. **Tes wajib memakai vault fixture di temp dir (`fs.mkdtemp`), tidak boleh menunjuk ke `/Users/haon/Documents/vault`.** Aplikasi menghapus file permanen.
- Commit tanpa trailer `Co-authored-by`/`Made-with`. Laporkan: file diubah + hasil `npm test`.

## Boleh disentuh
`src/lib/audit.ts`, `src/lib/vault.ts`, `src/lib/vault.test.ts`, `src/lib/audit.test.ts`, `src/lib/config.ts` (baru; baca `VAULT_ROOT` dan `AUDIT_FILE` dari env, error jelas bila kosong). Jangan ubah `types.ts` tanpa lapor.

## Perilaku
`audit.ts`
- `readAudit()`: baca `AUDIT_FILE`, validasi bentuk (tiap item punya `path` string, `verdict` salah satu dari tiga nilai, `reason` string, `reviewed` null/string), lempar error jelas bila rusak. Tolak `path` absolut atau mengandung `..`.
- `markReviewed(path)`: set `reviewed` = tanggal ISO hari ini. `removeItem(path)`: buang item dari file. Tulis atomik (tulis file temp di folder yang sama lalu `rename`).

`vault.ts`
- Guard `resolveSafe(relPath)` (dipakai semua fungsi): path harus relatif, berakhiran `.md`, tidak mengandung `..` atau byte NUL; `realpath(join(root, relPath))` harus berada di dalam `realpath(root)` (tambahkan separator saat membandingkan prefix agar `/vault2` tidak lolos sebagai `/vault`); file harus ada di `audit.json`. Bila target adalah symlink yang mengarah keluar vault: tolak (jangan ikuti, jangan hapus tujuan).
- `readNote(path)`: isi file, `mtime` ISO, item audit, `backlinks`.
- `backlinks(path)`: scan semua `.md` di vault (abaikan `.obsidian/`), cari `[[nama]]`, `[[nama|alias]]`, `[[nama#heading]]` dengan `nama` = nama file tanpa `.md` (case-insensitive, tanpa folder). Jangan menghitung catatan itu sendiri. Kembalikan path + nama.
- `listUnaudited(audit)`: semua `.md` di vault (abaikan `.obsidian/`) yang path-nya tidak ada di `audit.items`.
- `deleteNote(path)`: (1) `resolveSafe`, (2) hitung `brokenLinksIn` = backlinks selain `index.md`, (3) hapus file, (4) di `index.md` buang semua baris yang memuat link ke catatan itu (pola yang sama dengan backlinks), tulis ulang atomik, (5) `removeItem` dari audit, (6) kembalikan `DeleteResult`. Bila file sudah tidak ada: tetap bersihkan `index.md` dan audit, kembalikan hasil normal.

## Tes minimal (vitest, fixture temp)
- Guard menolak: `../x.md`, path absolut, bukan `.md`, symlink keluar vault, `vault2/` (prefix palsu), path tidak ada di audit.
- `backlinks` menangkap tiga bentuk wikilink dan tidak menghitung diri sendiri.
- `deleteNote`: file hilang, baris `index.md` terhapus, baris lain utuh, item audit hilang, `brokenLinksIn` benar; hapus kedua kali tidak error.
- `readAudit` menolak JSON rusak; `markReviewed` menulis tanggal.

## Kriteria selesai
`npm test` lulus; tidak ada akses ke luar temp dir selama tes.
