import { describe, expect, it } from 'bun:test';
import { redactSecrets } from '../src/cli/secrets';

describe('redactSecrets', () => {
  it('replaces credentials and keeps every other value intact', () => {
    const input = {
      orgUrl: 'https://dev.azure.com/acme',
      project: 'Demo',
      personalAccessToken: 'tok-123',
      password: 'pw-123',
      isOnPremises: false,
    };

    expect(redactSecrets(input)).toEqual({
      orgUrl: 'https://dev.azure.com/acme',
      project: 'Demo',
      personalAccessToken: '***',
      password: '***',
      isOnPremises: false,
    });
  });

  it('leaves an object without credentials untouched', () => {
    const input = { orgUrl: 'https://dev.azure.com/acme', project: 'Demo' };
    expect(redactSecrets(input)).toEqual(input);
  });

  it('does not mutate its input', () => {
    const input = { personalAccessToken: 'tok-123' };
    redactSecrets(input);
    expect(input.personalAccessToken).toBe('tok-123');
  });

  it('reaches credentials nested in objects and arrays', () => {
    const input = { profiles: [{ name: 'a', personalAccessToken: 'tok-123' }] };
    expect(redactSecrets(input)).toEqual({ profiles: [{ name: 'a', personalAccessToken: '***' }] });
  });

  it('passes primitives through', () => {
    expect(redactSecrets('plain')).toBe('plain');
    expect(redactSecrets(null)).toBeNull();
  });
});
