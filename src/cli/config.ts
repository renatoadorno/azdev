import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import { EntraAuthHandler } from '../services/EntraAuthHandler';
import {
  SECRET_CONFIG_KEYS,
  SECRET_SERVICE,
  configKeyFor,
  deleteSecret,
  envVarFor,
  resolveSecret,
  secretKindForKey,
  storeSecret,
  type SecretKind,
} from './secrets';

export function configPath(): string {
  const override = process.env.AZDEV_CONFIG_PATH;
  if (override) return override;
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(base, 'azdev', 'config.json');
}

/** A file kept next to config.json (flows.json, conventions.md), so AZDEV_CONFIG_PATH moves it too. */
export function siblingPath(fileName: string): string {
  return path.join(path.dirname(configPath()), fileName);
}

/** The per-user files azdev and its Claude Code skills read, and whether each exists. */
export function configFiles(): Record<'config' | 'flows' | 'conventions' | 'templates', { path: string; exists: boolean }> {
  const entry = (file: string) => ({ path: file, exists: fs.existsSync(file) });
  return {
    config: entry(configPath()),
    flows: entry(siblingPath('flows.json')),
    conventions: entry(siblingPath('conventions.md')),
    templates: entry(siblingPath('templates')),
  };
}

interface RawCliConfig {
  orgUrl?: string;
  project?: string;
  authType?: string;
  isOnPremises?: boolean;
  collection?: string | null;
  apiVersion?: string | null;
  username?: string;
  domain?: string;
  richTextFormat?: string;
  /** Credentials belong in the keychain; these only survive in legacy files. */
  personalAccessToken?: string;
  password?: string;
}

/** Reads the config file. Returns null when it does not exist; exits 2 when it is malformed. */
export function readConfigFile(): RawCliConfig | null {
  let content: string;
  try {
    content = fs.readFileSync(configPath(), 'utf-8');
  } catch {
    return null;
  }

  try {
    return JSON.parse(content) as RawCliConfig;
  } catch (err) {
    console.error(`Config file at ${configPath()} is not valid JSON: ${(err as Error).message}`);
    console.error('Fix the file or delete it and reconfigure.');
    process.exit(2);
  }
}

/** Same as readConfigFile, but a missing file is fatal. */
export function requireConfigFile(): RawCliConfig {
  const raw = readConfigFile();
  if (raw) return raw;

  console.error(`Config file not found at ${configPath()}.`);
  console.error("Run 'azdev config set orgUrl ...' to configure.");
  process.exit(2);
}

function writeConfigFile(data: Record<string, unknown>): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  // mode above only applies when the file is created; chmod fixes pre-existing 0644 files.
  fs.chmodSync(file, 0o600);
}

function warnIfWorldReadable(): void {
  try {
    const { mode } = fs.statSync(configPath());
    if ((mode & 0o077) === 0) return;
    console.error(
      `Warning: ${configPath()} is mode ${(mode & 0o777).toString(8)} — readable by other users. Fix with: chmod 600 ${configPath()}`,
    );
  } catch {
    // unreadable file is already reported by requireConfigFile
  }
}

/**
 * Moves credentials found in the plain-text config into the OS keychain, once.
 * A key is only dropped from disk after its keychain write succeeds — otherwise
 * a failing keychain would destroy the only copy of the credential.
 */
async function migrateInlineSecrets(raw: Record<string, unknown>, orgUrl: string): Promise<void> {
  const migrated: string[] = [];

  for (const key of SECRET_CONFIG_KEYS) {
    const value = raw[key];
    if (typeof value !== 'string' || value === '') continue;

    const kind = secretKindForKey(key)!;
    try {
      await storeSecret(kind, orgUrl, value);
    } catch (err) {
      console.error(`Warning: could not move ${key} to the OS keychain: ${(err as Error)?.message ?? err}`);
      console.error(`It stays in plain text at ${configPath()} and will not be used. Set ${envVarFor(kind)} instead.`);
      continue;
    }
    delete raw[key];
    migrated.push(key);
  }

  if (migrated.length === 0) return;

  const onDisk = readConfigFile() as Record<string, unknown>;
  for (const key of migrated) delete onDisk[key];
  writeConfigFile(onDisk);

  console.error(`Moved ${migrated.join(' and ')} from ${configPath()} to the OS keychain (service ${SECRET_SERVICE}).`);
}

async function requireSecret(kind: SecretKind, orgUrl: string): Promise<string> {
  const { value, error } = await resolveSecret(kind, orgUrl);
  if (value) return value;

  const key = configKeyFor(kind);
  console.error(`No ${key} found for ${orgUrl}.`);
  if (error) console.error(`Keychain lookup failed: ${error}`);
  console.error(`Store it with 'azdev config set ${key} <value>', or set ${envVarFor(kind)}.`);
  process.exit(2);
}

const RICH_TEXT_FORMATS = ['html', 'markdown'] as const;

function parseConfiguredFormat(value?: string): AzureDevOpsConfig['richTextFormat'] {
  if (value === undefined) return undefined;
  if ((RICH_TEXT_FORMATS as readonly string[]).includes(value)) return value as AzureDevOpsConfig['richTextFormat'];
  console.error(`Config richTextFormat must be 'html' or 'markdown' (got '${value}').`);
  console.error("Fix it with 'azdev config set richTextFormat markdown' or 'azdev config unset richTextFormat'.");
  process.exit(2);
}

function requireOrgUrl(): string {
  const { orgUrl } = requireConfigFile();
  if (orgUrl) return orgUrl;

  console.error('Set orgUrl before storing credentials:');
  console.error('  azdev config set orgUrl https://dev.azure.com/<org>');
  process.exit(2);
}

export async function loadCliConfig(): Promise<AzureDevOpsConfig> {
  const raw = requireConfigFile();
  warnIfWorldReadable();

  if (!raw.orgUrl || !raw.project) {
    console.error('Config is missing required fields: orgUrl and project.');
    console.error("Run 'azdev config set orgUrl ...' and 'azdev config set project ...' to configure.");
    process.exit(2);
  }

  await migrateInlineSecrets(raw as Record<string, unknown>, raw.orgUrl);

  const config: AzureDevOpsConfig = {
    orgUrl: raw.orgUrl,
    project: raw.project,
    personalAccessToken: '',
    isOnPremises: raw.isOnPremises ?? false,
    collection: raw.collection ?? undefined,
    apiVersion: raw.apiVersion ?? undefined,
    richTextFormat: parseConfiguredFormat(raw.richTextFormat),
  };

  const authType = raw.authType ?? 'pat';

  if (authType === 'entra') {
    config.auth = { type: 'entra' };
    config.entraAuthHandler = EntraAuthHandler.getInstance();
  } else if (authType === 'ntlm' || authType === 'basic') {
    const username = raw.username ?? '';
    const password = await requireSecret('password', raw.orgUrl);
    config.auth =
      authType === 'ntlm' ? { type: 'ntlm', username, password, domain: raw.domain } : { type: 'basic', username, password };
  } else {
    config.auth = { type: 'pat' };
    config.personalAccessToken = await requireSecret('pat', raw.orgUrl);
  }

  return config;
}

export async function writeCliConfig(key: string, value: unknown): Promise<void> {
  const kind = secretKindForKey(key);
  if (kind) {
    await storeSecret(kind, requireOrgUrl(), String(value));
    return;
  }

  const existing = (readConfigFile() ?? {}) as Record<string, unknown>;
  existing[key] = value;
  writeConfigFile(existing);
}

export async function unsetCliConfig(key: string): Promise<boolean> {
  const kind = secretKindForKey(key);
  if (kind) return deleteSecret(kind, requireOrgUrl());

  const existing = readConfigFile() as Record<string, unknown> | null;
  if (!existing || !(key in existing)) return false;

  delete existing[key];
  writeConfigFile(existing);
  return true;
}
