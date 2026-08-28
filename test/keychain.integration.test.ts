import { afterAll, describe, expect, it } from 'bun:test';
import { deleteSecret, resolveSecret, storeSecret } from '../src/cli/secrets';

// Opt-in: touches the real OS keychain (macOS Keychain / libsecret / Credential Manager).
// Run with: AZDEV_TEST_KEYCHAIN=1 bun test
const enabled = Boolean(process.env.AZDEV_TEST_KEYCHAIN);

// A throwaway orgUrl, so a real credential can never be read or overwritten.
const ORG = `https://azdev.invalid/integration-${process.pid}`;

describe.skipIf(!enabled)('Bun.secrets round-trip against the real keychain', () => {
  afterAll(async () => {
    await deleteSecret('pat', ORG).catch(() => {});
    await deleteSecret('password', ORG).catch(() => {});
  });

  it('stores, reads back and deletes a credential', async () => {
    await storeSecret('pat', ORG, 'integration-token');

    expect(await resolveSecret('pat', ORG)).toEqual({ value: 'integration-token', source: 'keychain' });
    expect(await deleteSecret('pat', ORG)).toBe(true);
    expect(await resolveSecret('pat', ORG)).toEqual({ value: null, source: 'none' });
  });

  it('overwrites an existing credential instead of duplicating it', async () => {
    await storeSecret('password', ORG, 'first');
    await storeSecret('password', ORG, 'second');

    expect((await resolveSecret('password', ORG)).value).toBe('second');
  });
});
