import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Synchronous fixture creation at top-level config.
// WebServer starts before globalSetup, so fixture must exist right away.
// Workers inherit process.env.HAKAI_E2E_TEMP_DIR so all workers reference the exact same fixture.
const fixtureBaseDir =
	process.env.HAKAI_E2E_TEMP_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'hakai-e2e-'));
process.env.HAKAI_E2E_TEMP_DIR = fixtureBaseDir;

const fixtureVaultDir = path.join(fixtureBaseDir, 'vault');
const fixtureAuditFile = path.join(fixtureBaseDir, 'audit.json');

process.env.HAKAI_E2E_VAULT_DIR = fixtureVaultDir;
process.env.HAKAI_E2E_AUDIT_FILE = fixtureAuditFile;

if (!fs.existsSync(fixtureVaultDir)) {
	fs.mkdirSync(path.join(fixtureVaultDir, 'projects'), { recursive: true });

	// Fixture minimal: index.md dengan baris [[a]], [[b]], [[c]], [[d]]
	fs.writeFileSync(
		path.join(fixtureVaultDir, 'index.md'),
		'# Index\n\n- [[a]]\n- [[b]]\n- [[c]]\n- [[d]]\n',
		'utf8'
	);

	// 4+ catatan di projects/, satu catatan memuat backlink ke catatan lain
	fs.writeFileSync(
		path.join(fixtureVaultDir, 'projects', 'a.md'),
		'# Proyek A\n\nCatatan aktif A. Merujuk ke [[b]].\n',
		'utf8'
	);
	fs.writeFileSync(
		path.join(fixtureVaultDir, 'projects', 'b.md'),
		'# Proyek B\n\nCatatan usang B. Memuat backlink ke [[a]].\n',
		'utf8'
	);
	fs.writeFileSync(
		path.join(fixtureVaultDir, 'projects', 'c.md'),
		'# Proyek C\n\nCatatan duplikat C.\n',
		'utf8'
	);
	fs.writeFileSync(
		path.join(fixtureVaultDir, 'projects', 'd.md'),
		'# Proyek D\n\nCatatan usang D draf lama.\n',
		'utf8'
	);

	// audit.json berisi semuanya (belum ditinjau)
	const initialAudit = {
		generatedAt: new Date().toISOString(),
		vaultRoot: fixtureVaultDir,
		items: [
			{
				path: 'projects/a.md',
				verdict: 'keep',
				reason: 'Proyek A aktif',
				reviewed: null
			},
			{
				path: 'projects/b.md',
				verdict: 'usang',
				reason: 'Proyek B sudah tidak dipakai',
				reviewed: null
			},
			{
				path: 'projects/c.md',
				verdict: 'duplikat',
				reason: 'Proyek C duplikat',
				reviewed: null
			},
			{
				path: 'projects/d.md',
				verdict: 'usang',
				reason: 'Proyek D usang',
				reviewed: null
			}
		]
	};

	fs.writeFileSync(fixtureAuditFile, JSON.stringify(initialAudit, null, 2) + '\n', 'utf8');
}

export { fixtureVaultDir, fixtureAuditFile };

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: 'http://127.0.0.1:4199',
		trace: 'on-first-retry'
	},
	metadata: {
		fixtureVaultDir,
		fixtureAuditFile
	},
	webServer: {
		command: 'npm run dev -- --port 4199 --strictPort',
		port: 4199,
		reuseExistingServer: false,
		env: {
			VAULT_ROOT: fixtureVaultDir,
			AUDIT_FILE: fixtureAuditFile
		}
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
