# Hakai 破

Tool web lokal untuk mereview hasil audit catatan vault Obsidian: tiap catatan diberi verdict (`keep` / `usang` / `duplikat`) oleh Claude, lalu kamu memutuskan **Keep** atau **Delete**.

> **Delete menghapus file secara permanen** (tanpa trash/archive) dan membuang baris `[[link]]` ke catatan itu di `index.md`. Tidak ada undo. Konfirmasi di UI dan guard path di server adalah satu-satunya pengaman; pastikan vault kamu di-backup (mis. git atau Time Machine).

## Prasyarat

- Node.js 22+
- Vault Obsidian (folder berisi `.md`) dan file `audit.json` hasil audit Claude

## Setup

```sh
npm ci
cp .env.example .env
```

Isi `.env`:

| Variabel | Arti |
|---|---|
| `VAULT_ROOT` | path absolut ke vault |
| `AUDIT_FILE` | path ke `audit.json` (default `./audit.json`) |

## Format `audit.json`

Contoh lengkap: `audit.sample.json`.

```json
{
  "generatedAt": "2026-11-13T03:00:00.000Z",
  "vaultRoot": "/path/ke/vault",
  "items": [
    { "path": "projects/hakai.md", "verdict": "usang", "reason": "Alasan singkat.", "reviewed": null }
  ]
}
```

- `path`: relatif terhadap `VAULT_ROOT`, pemisah `/`, berakhiran `.md`, tanpa `..`.
- `verdict`: `keep`, `usang`, atau `duplikat`.
- `reviewed`: `null` bila belum ditinjau, atau tanggal `YYYY-MM-DD` (diisi Hakai saat Keep).

Hanya path yang ada di `audit.json` yang bisa dihapus.

## Menjalankan

```sh
npm run dev                    # http://127.0.0.1:5173
# atau
npm run build && npm start     # server produksi, bind 127.0.0.1
```

Server hanya bind ke `127.0.0.1` (tanpa auth), jangan di-expose ke jaringan.

## Pemakaian

| Aksi | Cara |
|---|---|
| Pilih catatan | klik baris, atau `j` / `k` (URL `/?note=<path>` bertahan saat refresh) |
| Keep | tombol **Keep** atau `e` (menandai `reviewed`, catatan disembunyikan dari filter default) |
| Delete | tombol **Delete** atau `d`, lalu **Hapus permanen** di dialog |
| Aksi massal | centang baris (`x`), **Keep terpilih** / **Delete terpilih**; Delete massal minta mengetik jumlah item |
| Cari | `/` |

Banner kuning muncul bila `audit.json` lebih tua dari 14 hari atau ada `.md` di vault yang belum ada di audit (selain `index.md`).

Batasan: wikilink dicocokkan dengan nama file tanpa folder (seperti Obsidian). Nama kembar di folder berbeda (mis. `MEMORY.md` di beberapa `claude-memory/<project>/`) membuat backlinks dan pembersihan `index.md` bisa mencakup catatan lain bernama sama.

## Tes

```sh
npm test            # unit (vitest), memakai fixture di temp dir
npm run check       # svelte-check
npm run test:e2e    # Playwright, fixture temp + port khusus
```

Tes tidak pernah menyentuh vault asli: semuanya memakai fixture di temp dir. Jangan menjalankan tes atau skrip lain dengan `VAULT_ROOT` yang menunjuk vault asli.

## Struktur

```
src/lib/audit.ts    baca/tulis audit.json (atomik)
src/lib/vault.ts    satu-satunya akses file vault; semua guard path di sini
src/lib/filter.ts   filter + urutan daftar
src/routes/         halaman, load, form actions (keep/delete/bulk)
briefs/, docs/      brief subtask, PRD, desain, screenshot Figma
```
