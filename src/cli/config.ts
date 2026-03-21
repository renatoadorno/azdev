import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';

export const CONFIG_PATH = path.join(os.homedir(), '.config', 'azdev', 'config.json');

interface RawCliConfig {
  orgUrl?: string;
  project?: string;
  personalAccessToken?: string;
  authType?: string;
  isOnPremises?: boolean;
  collection?: string | null;
  apiVersion?: string | null;
  username?: string;
  password?: string;
  domain?: string;
}

export function loadCliConfig(): AzureDevOpsConfig {
  let raw: RawCliConfig = {};

  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    raw = JSON.parse(content);
  } catch {
    console.error(`Config file not found at ${CONFIG_PATH}.`);
    console.error("Run 'azdev config set orgUrl ...' to configure.");
    process.exit(2);
  }

  if (!raw.orgUrl || !raw.project) {
    console.error('Config is missing required fields: orgUrl and project.');
    console.error("Run 'azdev config set orgUrl ...' and 'azdev config set project ...' to configure.");
    process.exit(2);
  }

  const config: AzureDevOpsConfig = {
    orgUrl: raw.orgUrl,
    project: raw.project,
    personalAccessToken: raw.personalAccessToken ?? '',
    isOnPremises: raw.isOnPremises ?? false,
    collection: raw.collection ?? undefined,
    apiVersion: raw.apiVersion ?? undefined,
  };

  const authType = raw.authType ?? 'pat';
  if (authType === 'ntlm') {
    config.auth = { type: 'ntlm', username: raw.username ?? '', password: raw.password ?? '', domain: raw.domain };
  } else if (authType === 'basic') {
    config.auth = { type: 'basic', username: raw.username ?? '', password: raw.password ?? '' };
  } else if (authType === 'entra') {
    config.auth = { type: 'entra' };
  } else {
    config.auth = { type: 'pat' };
  }

  return config;
}

export function writeCliConfig(key: string, value: unknown): void {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    existing = JSON.parse(content);
  } catch {
    // start fresh if file doesn't exist or is invalid
  }

  existing[key] = value;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2), 'utf-8');
}
