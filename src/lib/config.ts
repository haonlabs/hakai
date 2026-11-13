/**
 * config.ts – reads VAULT_ROOT and AUDIT_FILE from environment.
 * Throws a clear error if either is missing.
 */

function requireEnv(name: string): string {
	const val = process.env[name];
	if (!val) {
		throw new Error(
			`Environment variable "${name}" is required but not set. ` +
				`Please define it in your .env file or shell environment.`
		);
	}
	return val;
}

export function getVaultRoot(): string {
	return requireEnv('VAULT_ROOT');
}

export function getAuditFile(): string {
	return requireEnv('AUDIT_FILE');
}
