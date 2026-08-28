import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { secrets } from 'bun';
import { createEnvGuard } from './helpers';
import {
  SECRET_SERVICE,
  deleteSecret,
  envVarFor,
  isSecretKey,
  resolveSecret,
  secretKindForKey,
  storeSecret,
} from '../src/cli/secrets';

const ORG = 'https://dev.azure.com/acme';

let env = createEnvGuard();
let get: ReturnType<typeof spyOn>;
let set: ReturnType<typeof spyOn>;
let remove: ReturnType<typeof spyOn>;

beforeEach(() => {
  env = createEnvGuard();
  env.set('AZDEV_PAT', undefined);
  env.set('AZDEV_PASSWORD', undefined);

  get = spyOn(secrets, 'get').mockResolvedValue(null as never);
  set = spyOn(secrets, 'set').mockResolvedValue(undefined as never);
  remove = spyOn(secrets, 'delete').mockResolvedValue(true as never);
});

afterEach(() => {
  env.restore();
  get.mockRestore();
  set.mockRestore();
  remove.mockRestore();
});

describe('key mapping', () => {
  it('maps config keys to keychain kinds', () => {
    expect(secretKindForKey('personalAccessToken')).toBe('pat');
    expect(secretKindForKey('password')).toBe('password');
    expect(secretKindForKey('project')).toBeUndefined();
  });

  it('recognises which keys are credentials', () => {
    expect(isSecretKey('personalAccessToken')).toBe(true);
    expect(isSecretKey('password')).toBe(true);
    expect(isSecretKey('orgUrl')).toBe(false);
  });

  it('maps kinds to their environment variables', () => {
    expect(envVarFor('pat')).toBe('AZDEV_PAT');
    expect(envVarFor('password')).toBe('AZDEV_PASSWORD');
  });
});

describe('resolveSecret precedence', () => {
  it('prefers the environment variable and skips the keychain entirely', async () => {
    env.set('AZDEV_PAT', 'from-env');
    get.mockResolvedValue('from-keychain' as never);

    expect(await resolveSecret('pat', ORG)).toEqual({ value: 'from-env', source: 'env' });
    expect(get).not.toHaveBeenCalled();
  });

  it('treats an empty environment variable as unset', async () => {
    env.set('AZDEV_PAT', '');
    get.mockResolvedValue('from-keychain' as never);

    expect(await resolveSecret('pat', ORG)).toEqual({ value: 'from-keychain', source: 'keychain' });
  });

  it('falls back to the keychain when no environment variable is set', async () => {
    get.mockResolvedValue('from-keychain' as never);

    expect(await resolveSecret('pat', ORG)).toEqual({ value: 'from-keychain', source: 'keychain' });
  });

  it('reports source none when the credential exists nowhere', async () => {
    expect(await resolveSecret('pat', ORG)).toEqual({ value: null, source: 'none' });
  });

  it('reports the reason when the keychain lookup itself fails', async () => {
    get.mockRejectedValue(new Error('no secret service') as never);

    const result = await resolveSecret('pat', ORG);

    expect(result.value).toBeNull();
    expect(result.source).toBe('none');
    expect(result.error).toContain('no secret service');
  });

  it('uses AZDEV_PASSWORD for the password kind', async () => {
    env.set('AZDEV_PASSWORD', 'pw-env');
    expect(await resolveSecret('password', ORG)).toEqual({ value: 'pw-env', source: 'env' });
  });
});

describe('keychain entry shape', () => {
  it('scopes the PAT entry by kind and orgUrl', async () => {
    await resolveSecret('pat', ORG);
    expect(get).toHaveBeenCalledWith({ service: SECRET_SERVICE, name: `pat:${ORG}` });
  });

  it('scopes the password entry by kind and orgUrl', async () => {
    await resolveSecret('password', ORG);
    expect(get).toHaveBeenCalledWith({ service: SECRET_SERVICE, name: `password:${ORG}` });
  });

  it('stores under the same entry it reads from', async () => {
    await storeSecret('pat', ORG, 'tok-123');
    expect(set).toHaveBeenCalledWith({ service: SECRET_SERVICE, name: `pat:${ORG}`, value: 'tok-123' });
  });

  it('deletes the same entry it reads from', async () => {
    expect(await deleteSecret('pat', ORG)).toBe(true);
    expect(remove).toHaveBeenCalledWith({ service: SECRET_SERVICE, name: `pat:${ORG}` });
  });

  it('keeps entries for different organizations apart', async () => {
    await resolveSecret('pat', 'https://dev.azure.com/other');
    expect(get).toHaveBeenCalledWith({
      service: SECRET_SERVICE,
      name: 'pat:https://dev.azure.com/other',
    });
  });
});
