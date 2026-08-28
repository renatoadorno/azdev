import { secrets } from 'bun';

/** Service name under which every azdev credential is stored in the OS keychain. */
export const SECRET_SERVICE = 'com.azdev.cli';

export type SecretKind = 'pat' | 'password';
export type SecretSource = 'env' | 'keychain' | 'none';

export interface ResolvedSecret {
  value: string | null;
  source: SecretSource;
  /** Set when the keychain lookup itself failed, so callers can explain why. */
  error?: string;
}

/** Single source of truth for the three names each credential answers to. */
const KINDS = {
  pat: { configKey: 'personalAccessToken', envVar: 'AZDEV_PAT' },
  password: { configKey: 'password', envVar: 'AZDEV_PASSWORD' },
} as const satisfies Record<SecretKind, { configKey: string; envVar: string }>;

export const SECRET_CONFIG_KEYS = Object.values(KINDS).map((k) => k.configKey);

export function secretKindForKey(key: string): SecretKind | undefined {
  return (Object.keys(KINDS) as SecretKind[]).find((kind) => KINDS[kind].configKey === key);
}

export function isSecretKey(key: string): boolean {
  return secretKindForKey(key) !== undefined;
}

export function configKeyFor(kind: SecretKind): string {
  return KINDS[kind].configKey;
}

export function envVarFor(kind: SecretKind): string {
  return KINDS[kind].envVar;
}

// Scoping by orgUrl keeps credentials for different organizations apart and keeps
// the entry readable in Keychain Access / seahorse.
function entry(kind: SecretKind, orgUrl: string) {
  return { service: SECRET_SERVICE, name: `${kind}:${orgUrl}` };
}

export async function resolveSecret(kind: SecretKind, orgUrl: string): Promise<ResolvedSecret> {
  const fromEnv = process.env[envVarFor(kind)];
  if (fromEnv) return { value: fromEnv, source: 'env' };

  try {
    const value = await secrets.get(entry(kind, orgUrl));
    return value ? { value, source: 'keychain' } : { value: null, source: 'none' };
  } catch (err) {
    return { value: null, source: 'none', error: (err as Error)?.message ?? String(err) };
  }
}

export async function storeSecret(kind: SecretKind, orgUrl: string, value: string): Promise<void> {
  await secrets.set({ ...entry(kind, orgUrl), value });
}

export async function deleteSecret(kind: SecretKind, orgUrl: string): Promise<boolean> {
  return secrets.delete(entry(kind, orgUrl));
}

/** Replaces credential values with a placeholder so config output never carries a secret. */
export function redactSecrets<T>(data: T): T {
  if (Array.isArray(data)) return data.map((item) => redactSecrets(item)) as T;
  if (data === null || typeof data !== 'object') return data;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = isSecretKey(key) ? '***' : redactSecrets(value);
  }
  return out as T;
}
