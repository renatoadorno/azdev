import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as fs from 'fs';
import {
  ExitError,
  captureExit,
  captureStderr,
  cleanupTempConfigs,
  createEnvGuard,
  fileMode,
  makeTempConfig,
  readConfigFile,
} from './helpers';
import type { SecretKind } from '../src/cli/secrets';

const actualSecrets = await import('../src/cli/secrets');

// Only the three IO functions are faked; key naming and env-var mapping stay real.
// Precedence between env and keychain belongs to resolveSecret itself and is
// covered against the real implementation in secrets.test.ts.
const keychain = new Map<string, string>();
const calls = { resolve: [] as string[][], store: [] as string[][], remove: [] as string[][] };
let storeFailure: Error | null = null;

mock.module('../src/cli/secrets', () => ({
  ...actualSecrets,
  resolveSecret: async (kind: SecretKind, orgUrl: string) => {
    calls.resolve.push([kind, orgUrl]);
    const value = keychain.get(`${kind}:${orgUrl}`);
    return value ? { value, source: 'keychain' } : { value: null, source: 'none' };
  },
  storeSecret: async (kind: SecretKind, orgUrl: string, value: string) => {
    calls.store.push([kind, orgUrl, value]);
    if (storeFailure) throw storeFailure;
    keychain.set(`${kind}:${orgUrl}`, value);
  },
  deleteSecret: async (kind: SecretKind, orgUrl: string) => {
    calls.remove.push([kind, orgUrl]);
    return keychain.delete(`${kind}:${orgUrl}`);
  },
}));

let cfg: typeof import('../src/cli/config');
beforeAll(async () => {
  cfg = await import('../src/cli/config');
});

const ORG = 'https://dev.azure.com/acme';
const base = { orgUrl: ORG, project: 'Demo' };

let env = createEnvGuard();
let exit = captureExit();
let stderr = captureStderr();

beforeEach(() => {
  keychain.clear();
  calls.resolve.length = 0;
  calls.store.length = 0;
  calls.remove.length = 0;
  storeFailure = null;

  env = createEnvGuard();
  env.set('AZDEV_PAT', undefined);
  env.set('AZDEV_PASSWORD', undefined);
  env.set('XDG_CONFIG_HOME', undefined);

  exit = captureExit();
  stderr = captureStderr();
});

afterEach(() => {
  env.restore();
  exit.mockRestore();
  stderr.spy.mockRestore();
  cleanupTempConfigs();
});

function useConfig(contents: Record<string, unknown> | string | null, mode?: number): string {
  const file = makeTempConfig(contents, mode);
  env.set('AZDEV_CONFIG_PATH', file);
  return file;
}

async function expectExit(code: number, fn: () => Promise<unknown>) {
  await expect(fn()).rejects.toBeInstanceOf(ExitError);
  expect(exit).toHaveBeenCalledWith(code);
}

describe('configPath', () => {
  it('prefers AZDEV_CONFIG_PATH over everything else', () => {
    env.set('AZDEV_CONFIG_PATH', '/tmp/explicit.json');
    env.set('XDG_CONFIG_HOME', '/tmp/xdg');
    expect(cfg.configPath()).toBe('/tmp/explicit.json');
  });

  it('falls back to XDG_CONFIG_HOME', () => {
    env.set('AZDEV_CONFIG_PATH', undefined);
    env.set('XDG_CONFIG_HOME', '/tmp/xdg');
    expect(cfg.configPath()).toBe('/tmp/xdg/azdev/config.json');
  });

  it('falls back to ~/.config when nothing is set', () => {
    env.set('AZDEV_CONFIG_PATH', undefined);
    env.set('XDG_CONFIG_HOME', undefined);
    expect(cfg.configPath()).toBe(`${process.env.HOME}/.config/azdev/config.json`);
  });
});

describe('loadCliConfig — file validation', () => {
  it('exits 2 when the config file is missing', async () => {
    useConfig(null);
    await expectExit(2, () => cfg.loadCliConfig());
    expect(stderr.text()).toContain('not found');
  });

  it('exits 2 with a distinct message when the config file is not valid JSON', async () => {
    useConfig('{ not json');
    await expectExit(2, () => cfg.loadCliConfig());
    expect(stderr.text()).toContain('not valid JSON');
    expect(stderr.text()).not.toContain('not found');
  });

  it('exits 2 when orgUrl is missing', async () => {
    useConfig({ project: 'Demo' });
    await expectExit(2, () => cfg.loadCliConfig());
    expect(stderr.text()).toContain('orgUrl');
  });

  it('exits 2 when project is missing', async () => {
    useConfig({ orgUrl: ORG });
    await expectExit(2, () => cfg.loadCliConfig());
    expect(stderr.text()).toContain('project');
  });
});

describe('loadCliConfig — credential resolution', () => {
  it('reads the PAT from the keychain for authType pat', async () => {
    useConfig({ ...base, authType: 'pat' });
    keychain.set(`pat:${ORG}`, 'tok-123');

    const config = await cfg.loadCliConfig();

    expect(config.personalAccessToken).toBe('tok-123');
    expect(calls.resolve).toEqual([['pat', ORG]]);
  });

  it('defaults to pat when authType is absent', async () => {
    useConfig(base);
    keychain.set(`pat:${ORG}`, 'tok-123');

    const config = await cfg.loadCliConfig();

    expect(config.auth).toEqual({ type: 'pat' });
    expect(config.personalAccessToken).toBe('tok-123');
  });

  it('exits 2 with a hint when no PAT is stored anywhere', async () => {
    useConfig(base);
    await expectExit(2, () => cfg.loadCliConfig());
    expect(stderr.text()).toContain('azdev config set personalAccessToken');
    expect(stderr.text()).toContain('AZDEV_PAT');
  });

  it('never looks up a secret for authType entra', async () => {
    useConfig({ ...base, authType: 'entra' });

    const config = await cfg.loadCliConfig();

    expect(calls.resolve).toEqual([]);
    expect(config.personalAccessToken).toBe('');
    expect(config.auth).toEqual({ type: 'entra' });
  });

  it('reads the password from the keychain for ntlm and keeps username/domain on disk', async () => {
    useConfig({ ...base, authType: 'ntlm', username: 'alice', domain: 'CORP' });
    keychain.set(`password:${ORG}`, 'pw-123');

    const config = await cfg.loadCliConfig();

    expect(calls.resolve).toEqual([['password', ORG]]);
    expect(config.auth).toEqual({ type: 'ntlm', username: 'alice', password: 'pw-123', domain: 'CORP' });
  });

  it('reads the password from the keychain for basic', async () => {
    useConfig({ ...base, authType: 'basic', username: 'alice' });
    keychain.set(`password:${ORG}`, 'pw-123');

    const config = await cfg.loadCliConfig();

    expect(config.auth).toEqual({ type: 'basic', username: 'alice', password: 'pw-123' });
  });

  it('treats an unknown authType as pat', async () => {
    useConfig({ ...base, authType: 'entraid' });
    keychain.set(`pat:${ORG}`, 'tok-123');

    const config = await cfg.loadCliConfig();

    expect(config.auth).toEqual({ type: 'pat' });
    expect(config.personalAccessToken).toBe('tok-123');
  });
});

describe('loadCliConfig — migration of inline secrets', () => {
  it('moves an inline PAT to the keychain and strips it from disk', async () => {
    const file = useConfig({ ...base, personalAccessToken: 'legacy-tok' }, 0o644);

    const config = await cfg.loadCliConfig();

    expect(calls.store).toEqual([['pat', ORG, 'legacy-tok']]);
    expect(readConfigFile(file)).not.toHaveProperty('personalAccessToken');
    expect(readConfigFile(file).orgUrl).toBe(ORG);
    expect(fileMode(file)).toBe(0o600);
    expect(config.personalAccessToken).toBe('legacy-tok');
    expect(stderr.text()).toContain('keychain');
  });

  it('moves an inline password to the keychain', async () => {
    const file = useConfig({ ...base, authType: 'basic', username: 'alice', password: 'legacy-pw' });

    const config = await cfg.loadCliConfig();

    expect(calls.store).toEqual([['password', ORG, 'legacy-pw']]);
    expect(readConfigFile(file)).not.toHaveProperty('password');
    expect(config.auth).toEqual({ type: 'basic', username: 'alice', password: 'legacy-pw' });
  });

  it('keeps the token on disk and refuses to use it when the keychain write fails', async () => {
    const file = useConfig({ ...base, personalAccessToken: 'legacy-tok' });
    storeFailure = new Error('no secret service');

    await expectExit(2, () => cfg.loadCliConfig());

    expect(readConfigFile(file).personalAccessToken).toBe('legacy-tok');
    expect(stderr.text()).toContain('no secret service');
    expect(stderr.text()).toContain('AZDEV_PAT');
  });

  it('does not migrate again once the file is clean', async () => {
    useConfig({ ...base, personalAccessToken: 'legacy-tok' });
    await cfg.loadCliConfig();

    calls.store.length = 0;
    stderr.lines.length = 0;

    await cfg.loadCliConfig();

    expect(calls.store).toEqual([]);
    expect(stderr.text()).not.toContain('Moved');
  });

  it('ignores an empty inline secret', async () => {
    useConfig({ ...base, personalAccessToken: '' });
    keychain.set(`pat:${ORG}`, 'tok-123');

    await cfg.loadCliConfig();

    expect(calls.store).toEqual([]);
  });
});

describe('loadCliConfig — file permissions', () => {
  it('warns when the config file is readable by other users', async () => {
    useConfig({ ...base }, 0o644);
    keychain.set(`pat:${ORG}`, 'tok-123');

    await cfg.loadCliConfig();

    expect(stderr.text()).toContain('readable by other users');
  });

  it('stays quiet when the config file is 0600', async () => {
    useConfig({ ...base }, 0o600);
    keychain.set(`pat:${ORG}`, 'tok-123');

    await cfg.loadCliConfig();

    expect(stderr.text()).not.toContain('readable by other users');
  });
});

describe('writeCliConfig', () => {
  it('writes non-secret keys to the file with mode 0600', async () => {
    const file = useConfig({ ...base });

    await cfg.writeCliConfig('project', 'Other');

    expect(readConfigFile(file).project).toBe('Other');
    expect(fileMode(file)).toBe(0o600);
    expect(calls.store).toEqual([]);
  });

  it('tightens the permissions of a legacy 0644 file', async () => {
    const file = useConfig({ ...base }, 0o644);

    await cfg.writeCliConfig('project', 'Other');

    expect(fileMode(file)).toBe(0o600);
  });

  it('creates the config directory with mode 0700', async () => {
    const file = makeTempConfig(null);
    const nested = `${file}-dir/config.json`;
    env.set('AZDEV_CONFIG_PATH', nested);

    await cfg.writeCliConfig('orgUrl', ORG);

    expect(fs.statSync(`${file}-dir`).mode & 0o777).toBe(0o700);
  });

  it('sends the PAT to the keychain and never to the file', async () => {
    const file = useConfig({ ...base });

    await cfg.writeCliConfig('personalAccessToken', 'tok-new');

    expect(calls.store).toEqual([['pat', ORG, 'tok-new']]);
    expect(readConfigFile(file)).not.toHaveProperty('personalAccessToken');
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('tok-new');
  });

  it('sends the password to the keychain and never to the file', async () => {
    const file = useConfig({ ...base });

    await cfg.writeCliConfig('password', 'pw-new');

    expect(calls.store).toEqual([['password', ORG, 'pw-new']]);
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('pw-new');
  });

  it('exits 2 when storing a credential before orgUrl is configured', async () => {
    useConfig({ project: 'Demo' });
    await expectExit(2, () => cfg.writeCliConfig('personalAccessToken', 'tok-new'));
    expect(calls.store).toEqual([]);
  });
});

describe('unsetCliConfig', () => {
  it('deletes the PAT from the keychain', async () => {
    useConfig({ ...base });
    keychain.set(`pat:${ORG}`, 'tok-123');

    expect(await cfg.unsetCliConfig('personalAccessToken')).toBe(true);
    expect(calls.remove).toEqual([['pat', ORG]]);
    expect(keychain.has(`pat:${ORG}`)).toBe(false);
  });

  it('reports false when there is no stored credential to delete', async () => {
    useConfig({ ...base });
    expect(await cfg.unsetCliConfig('personalAccessToken')).toBe(false);
  });

  it('removes a non-secret key from the file and keeps it at 0600', async () => {
    const file = useConfig({ ...base, collection: 'DefaultCollection' }, 0o644);

    expect(await cfg.unsetCliConfig('collection')).toBe(true);
    expect(readConfigFile(file)).not.toHaveProperty('collection');
    expect(fileMode(file)).toBe(0o600);
  });

  it('reports false for a key that is not set', async () => {
    useConfig({ ...base });
    expect(await cfg.unsetCliConfig('collection')).toBe(false);
  });
});
