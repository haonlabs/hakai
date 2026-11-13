# Brief 01: scaffold (S)

## Tujuan
Membuat project SvelteKit kosong yang bisa `dev`, `build`, dan `test` di folder project ini.

## Aturan umum
- Hanya source code/config. Jangan ubah `docs/`, `briefs/`, `CLAUDE.md`. Jangan baca atau sentuh `/Users/haon/Documents/vault`.
- Commit di branch ini; **tanpa** trailer `Co-authored-by`/`Made-with`/atribusi agent. Laporkan ringkas: file dibuat + hasil build/test.

## Yang dikerjakan
1. Scaffold SvelteKit (Svelte 5, TypeScript, template minimal) di root project ini (folder tidak kosong: scaffold ke folder temp lalu pindahkan isinya, jangan timpa `docs/`, `briefs/`, `CLAUDE.md`). Package manager: npm.
2. Tambah Tailwind (lewat `sv add tailwindcss`), vitest, `@sveltejs/adapter-node`.
3. Tambah dependency runtime: `marked`, `isomorphic-dompurify`. Tidak ada library lain.
4. `src/lib/types.ts` persis seperti kontrak di `briefs/00-index.md`.
5. `.env.example`: `VAULT_ROOT=/path/ke/vault` dan `AUDIT_FILE=./audit.json`. `.gitignore`: `.env`, `audit.json`, `node_modules`, `build`, `.svelte-kit`.
6. `audit.sample.json`: 3 item contoh sesuai kontrak `Audit`.
7. `package.json` scripts: `dev` = `vite dev --host 127.0.0.1`, `start` = `HOST=127.0.0.1 node build`, `test` = `vitest run`.
8. Halaman `/` placeholder bertuliskan "Hakai".

## Kriteria selesai
- `npm run build` dan `npm test` (boleh 0 tes tapi tidak error) lulus.
- `npm run dev` melayani `http://127.0.0.1:5173` hanya di loopback.
