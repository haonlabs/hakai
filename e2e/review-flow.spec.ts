import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

test('audit review flow: keep note, delete note via dialog, and bulk delete with numeric confirmation', async ({
	page
}, testInfo) => {
	// Ambil path fixture dari metadata config atau env fixture khusus e2e (BUKAN dari shell VAULT_ROOT)
	const metadata = testInfo.config.metadata as {
		fixtureVaultDir: string;
		fixtureAuditFile: string;
	};
	const vaultDir = metadata.fixtureVaultDir || process.env.HAKAI_E2E_VAULT_DIR!;
	const auditFile = metadata.fixtureAuditFile || process.env.HAKAI_E2E_AUDIT_FILE!;

	expect(vaultDir).toBeDefined();
	expect(auditFile).toBeDefined();

	// Pastikan fixture awal lengkap di temp directory
	expect(fs.existsSync(path.join(vaultDir, 'index.md'))).toBe(true);
	expect(fs.existsSync(path.join(vaultDir, 'projects/a.md'))).toBe(true);
	expect(fs.existsSync(path.join(vaultDir, 'projects/b.md'))).toBe(true);
	expect(fs.existsSync(path.join(vaultDir, 'projects/c.md'))).toBe(true);
	expect(fs.existsSync(path.join(vaultDir, 'projects/d.md'))).toBe(true);

	const initialIndex = fs.readFileSync(path.join(vaultDir, 'index.md'), 'utf8');
	expect(initialIndex).toContain('[[a]]');
	expect(initialIndex).toContain('[[b]]');
	expect(initialIndex).toContain('[[c]]');
	expect(initialIndex).toContain('[[d]]');

	// 1. Jalankan server dengan VAULT_ROOT fixture (dilakukan via webServer) dan buka aplikasi
	await page.goto('/');
	await expect(page).toHaveTitle(/Hakai/);
	await page.waitForLoadState('networkidle');

	// Awalnya 4 catatan ada di tabel
	await expect(page.locator('tbody tr')).toHaveCount(4);
	await expect(page.locator('.name-cell', { hasText: /^a$/ })).toBeVisible();
	await expect(page.locator('.name-cell', { hasText: /^b$/ })).toBeVisible();
	await expect(page.locator('.name-cell', { hasText: /^c$/ })).toBeVisible();
	await expect(page.locator('.name-cell', { hasText: /^d$/ })).toBeVisible();

	// 2. Keep satu catatan (item tersembunyi dari filter default)
	// Klik baris catatan "a" untuk membuka detail (dengan retry toPass untuk mencegah hydration race)
	await expect(async () => {
		await page
			.locator('tbody tr')
			.filter({ has: page.locator('.name-cell', { hasText: /^a$/ }) })
			.click();
		await expect(page.locator('.detail-panel')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 5000 });
	await expect(page.locator('.detail-heading h2')).toHaveText('a');

	// Klik tombol Keep
	await page.locator('#keep-current button').click();

	// Catatan "a" sekarang tersembunyi dari filter default (hideReviewed = 1)
	await expect(page.locator('.name-cell', { hasText: /^a$/ })).toBeHidden();
	await expect(page.locator('tbody tr')).toHaveCount(3);

	// File "a.md" tetap ada di fixture vault
	expect(fs.existsSync(path.join(vaultDir, 'projects/a.md'))).toBe(true);

	// Status di audit.json berubah menjadi reviewed (non-null)
	await expect
		.poll(() => {
			const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
			const itemA = audit.items.find((it: { path: string }) => it.path === 'projects/a.md');
			return itemA?.reviewed;
		})
		.toBeTruthy();

	// 3. Delete satu catatan lewat dialog
	// Klik baris catatan "b" untuk membuka detail
	await page.locator('tbody tr').filter({ has: page.locator('.name-cell', { hasText: /^b$/ }) }).click();
	await expect(page.locator('.detail-heading h2')).toHaveText('b');

	// Klik tombol Delete untuk memunculkan dialog konfirmasi
	await page.locator('.detail-actions button.danger', { hasText: 'Delete' }).click();

	const deleteDialog = page.locator('dialog.confirm-dialog', {
		hasText: 'Hapus catatan ini secara permanen?'
	});
	await expect(deleteDialog).toBeVisible();
	await expect(deleteDialog.locator('.path-box')).toHaveText('projects/b.md');

	// Konfirmasi hapus permanen lewat dialog
	await deleteDialog.getByRole('button', { name: 'Hapus permanen' }).click();
	await expect(deleteDialog).toBeHidden();

	// Assert: item hilang dari daftar
	await expect(page.locator('.name-cell', { hasText: /^b$/ })).toBeHidden();
	await expect(page.locator('tbody tr')).toHaveCount(2);

	// Assert: file hilang dari fixture
	await expect
		.poll(() => fs.existsSync(path.join(vaultDir, 'projects/b.md')))
		.toBe(false);

	// Assert: baris index.md bersih dari [[b]]
	await expect
		.poll(() => {
			const content = fs.readFileSync(path.join(vaultDir, 'index.md'), 'utf8');
			return content.includes('[[b]]');
		})
		.toBe(false);

	const indexAfterDeleteB = fs.readFileSync(path.join(vaultDir, 'index.md'), 'utf8');
	expect(indexAfterDeleteB).toContain('[[a]]');
	expect(indexAfterDeleteB).toContain('[[c]]');
	expect(indexAfterDeleteB).toContain('[[d]]');

	// Assert: item hilang dari audit.json
	await expect
		.poll(() => {
			const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
			return audit.items.some((it: { path: string }) => it.path === 'projects/b.md');
		})
		.toBe(false);

	// 4. Delete massal dengan konfirmasi angka
	// Centang sisa catatan (c dan d)
	await page.getByRole('checkbox', { name: 'Pilih c' }).check();
	await page.getByRole('checkbox', { name: 'Pilih d' }).check();

	// Buka dialog delete massal
	await page.getByRole('button', { name: 'Delete terpilih' }).click();

	const bulkDialog = page.locator('dialog.confirm-dialog', {
		hasText: 'Hapus catatan terpilih?'
	});
	await expect(bulkDialog).toBeVisible();

	const bulkConfirmBtn = bulkDialog.getByRole('button', { name: 'Hapus permanen' });
	// Tombol harus disabled sebelum mengetik angka konfirmasi yang benar
	await expect(bulkConfirmBtn).toBeDisabled();

	// Masukkan angka yang salah (misal "1")
	const countInput = bulkDialog.locator('input[inputmode="numeric"]');
	await countInput.fill('1');
	await expect(bulkConfirmBtn).toBeDisabled();

	// Masukkan angka konfirmasi yang benar ("2")
	await countInput.fill('2');
	await expect(bulkConfirmBtn).toBeEnabled();

	// Klik hapus permanen di dialog bulk
	await bulkConfirmBtn.click();
	await expect(bulkDialog).toBeHidden();

	// Assert: kedua item hilang dari daftar UI
	await expect(page.locator('.name-cell', { hasText: /^c$/ })).toBeHidden();
	await expect(page.locator('.name-cell', { hasText: /^d$/ })).toBeHidden();
	await expect(page.locator('.empty-state')).toBeVisible();

	// Assert: file c dan d hilang dari fixture
	await expect
		.poll(() => fs.existsSync(path.join(vaultDir, 'projects/c.md')))
		.toBe(false);
	await expect
		.poll(() => fs.existsSync(path.join(vaultDir, 'projects/d.md')))
		.toBe(false);

	// Assert: baris index.md bersih dari [[c]] dan [[d]]
	await expect
		.poll(() => {
			const content = fs.readFileSync(path.join(vaultDir, 'index.md'), 'utf8');
			return content.includes('[[c]]') || content.includes('[[d]]');
		})
		.toBe(false);

	// Assert: item c dan d hilang dari audit.json
	await expect
		.poll(() => {
			const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
			return audit.items.some(
				(it: { path: string }) => it.path === 'projects/c.md' || it.path === 'projects/d.md'
			);
		})
		.toBe(false);
});
