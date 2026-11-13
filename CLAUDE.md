# Hakai

Tool web lokal untuk mereview hasil audit catatan vault Obsidian (Keep / Delete permanen).
Sumber kebenaran dokumen: vault `~/Documents/vault/hakai-prd.md` dan `hakai-design.md` (salinan snapshot di `docs/`).
UI di Figma: https://www.figma.com/design/ssh9G7MjV65LY9fsXOCFDd (screenshot di `docs/figma/`).

- Stack: SvelteKit (Svelte 5) + TypeScript + Tailwind, adapter-node, vitest. Tanpa database, tanpa auth, bind 127.0.0.1.
- **Jangan pernah menjalankan tes atau skrip yang menunjuk ke vault asli** (`/Users/haon/Documents/vault`). Tes selalu memakai fixture di temp dir. Aplikasi menghapus file permanen.
- Brief kerja per subtask: `briefs/00-index.md` (urutan, kontrak antar modul, tag S/M/L).
- Arsitektur kerja: Claude analisa/review/UI-UX; source code didelegasikan lewat Orca (lihat vault `AI Workflow/Orca Workflow.md`).
