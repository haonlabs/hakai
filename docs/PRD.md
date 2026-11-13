---
tags: [proyek, prd, hakai]
status: draft
---
# Hakai — PRD

Status: draf 13 Nov 2026, menunggu review. Desain: [[hakai-design]].

## Masalah
Vault Obsidian dan `claude-memory/` (±87 file memory + ±35 catatan) terus bertambah. Tidak ada mekanisme yang menghapus catatan yang sudah tidak terpakai (proyek selesai, keputusan digantikan, bug sudah fix), jadi `index.md` dan memory makin penuh dan memory usang ikut terbaca Claude di tiap sesi.

## Tujuan
1. Audit berkala catatan usang dilakukan Claude, hasilnya bisa direview manusia di satu tempat.
2. User memutuskan per catatan: Keep atau Delete, dengan konteks (isi, alasan audit, siapa yang me-link).
3. Keputusan langsung diterapkan ke file di vault, tanpa langkah manual di Finder/Obsidian.

## Non-goals
- Bukan editor catatan (edit tetap di Obsidian).
- Bukan audit otomatis terjadwal; audit dijalankan saat user minta ke Claude.
- Tidak ada archive/trash internal (keputusan user 13 Nov 2026: Delete = hapus langsung).
- Tidak multi-user, tidak di-deploy; hanya localhost.

## Pengguna
Satu orang (pemilik vault), di Mac, buka lewat browser saat review.

## Alur utama
1. User minta Claude "audit vault". Claude membaca semua `.md` di vault + `claude-memory/`, menilai tiap catatan, menulis `audit.json`.
2. User buka `http://localhost:3000`, melihat daftar terurut menurut verdict.
3. User klik catatan → melihat isi, alasan audit, backlinks. Pilih **Keep** atau **Delete**.
4. Delete: konfirmasi → file dihapus, baris `[[link]]` di `index.md` ikut dihapus.
5. Keep: catatan ditandai ditinjau (tanggal `reviewed` di `audit.json`) supaya tidak muncul lagi di audit berikutnya.

## Requirements fungsional
| ID | Requirement | Prioritas |
|---|---|---|
| F1 | Daftar catatan dari `audit.json`: nama, sumber (vault / claude-memory), verdict, alasan singkat | Must |
| F2 | Filter verdict (usang, duplikat, keep, belum ditinjau) dan sumber; search nama | Must |
| F3 | Detail: render isi Markdown, alasan lengkap, backlinks, tanggal ubah terakhir | Must |
| F4 | Delete dengan dialog konfirmasi; hapus file + baris link di `index.md` | Must |
| F5 | Keep: simpan `reviewed` + tanggal, sembunyikan dari filter default | Must |
| F6 | Aksi massal: pilih beberapa lalu Delete / Keep sekaligus | Should |
| F7 | Peringatan bila catatan yang akan dihapus masih di-link catatan lain (tampilkan jumlah dan daftar) | Must |
| F8 | Indikator audit basi (`audit.json` lebih lama dari N hari / ada file baru yang belum dinilai) | Should |

## Requirements non-fungsional
- **Keamanan:** server hanya bind `127.0.0.1`; hanya boleh menghapus file `.md` yang path-nya ada di dalam root vault (tolak `..`, symlink keluar vault).
- **Tidak merusak:** file tidak ada di `audit.json` tidak bisa dihapus lewat UI.
- **Ringan:** buka daftar 150 catatan < 1 detik.
- **Tanpa database:** sumber kebenaran = file di vault + `audit.json`.

## Format `audit.json` (kontrak dengan Claude)
```json
{
  "generatedAt": "2026-11-13T10:00:00+07:00",
  "vaultRoot": "/Users/haon/Documents/vault",
  "items": [
    {
      "path": "claude-memory/home/jira-proj-lama.md",
      "verdict": "usang",
      "reason": "Jira ditinggalkan sejak 9 Nov 2026, diganti Mira.",
      "reviewed": null
    }
  ]
}
```
`verdict`: `keep` | `usang` | `duplikat`. `reviewed`: `null` atau tanggal ISO (ditulis oleh web saat Keep).

## Kriteria audit (untuk Claude)
Usang bila: proyek/bug berstatus selesai dan tidak ada konteks lanjutan; keputusan sudah digantikan keputusan lain; isi sudah tercermin di kode/CLAUDE.md; sumber info sudah tidak dipakai. Duplikat bila isinya tumpang tindih dengan catatan lain. Ragu → `keep`, jangan `usang`.

## Metrik sukses
- Satu sesi review ≤ 15 menit untuk ±120 catatan.
- Nol penghapusan file di luar vault; nol file terhapus yang tidak ada di audit.

## Risiko
| Risiko | Mitigasi |
|---|---|
| Delete permanen salah klik | Dialog konfirmasi menampilkan nama file + backlinks; aksi massal butuh konfirmasi ketik jumlah |
| Penilaian Claude keliru | Verdict ragu → `keep`; user selalu yang memutuskan |
| Backlink rusak di catatan lain | F7 memperingatkan sebelum hapus |
| Vault tidak di git (tak bisa undo) | Disetujui user; saran: cek Time Machine/iCloud sebelum review massal |

## Open questions
- Apakah `claude-memory/` (symlink) boleh dihapus lewat path symlink-nya? Rencana: ya, hapus file di tujuan symlink.
- Perlu ambang "audit basi" berapa hari (F8)? Usul 14 hari.
