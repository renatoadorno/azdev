import { describe, expect, it } from 'bun:test';
import { ConfigError } from '../src/cli/config';
import { toServeError } from '../src/serve/errors';
import { ProtocolError } from '../src/serve/protocol';

const upstream = (statusCode: number, message = 'boom') => Object.assign(new Error(message), { statusCode });
const socket = (code: string) => Object.assign(new Error(`connect ${code}`), { code });

describe('toServeError', () => {
  it('keeps the kind, message and hint of a protocol error', () => {
    expect(toServeError(new ProtocolError('invalid_request', 'Unknown method', 7, 'Methods: hello'))).toEqual({
      kind: 'invalid_request',
      message: 'Unknown method',
      hint: 'Methods: hello',
    });
  });

  it('turns a config error into its kind, with the way out as the hint', () => {
    const err = new ConfigError('needs_login', ['No personalAccessToken found.', "Store it with 'azdev config set personalAccessToken <value>'."]);
    expect(toServeError(err)).toEqual({
      kind: 'needs_login',
      message: 'No personalAccessToken found.',
      hint: "Store it with 'azdev config set personalAccessToken <value>'.",
    });
  });

  it('leaves the hint out when there is nothing to add', () => {
    expect(toServeError(new ProtocolError('unauthorized', 'bad hello'))).not.toHaveProperty('hint');
  });

  it('asks for a new token on a 401', () => {
    const error = toServeError(upstream(401));
    expect(error.kind).toBe('needs_login');
    expect(error.hint).toContain('azdev config set personalAccessToken');
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [412, 'conflict'],
    [429, 'rate_limited'],
    [500, 'upstream'],
    [503, 'upstream'],
    [400, 'internal'],
  ] as const)('maps HTTP %d to %s', (status, kind) => {
    expect(toServeError(upstream(status)).kind).toBe(kind);
  });

  it('recognises a stale revision by its TF code whatever the status', () => {
    expect(toServeError(upstream(400, 'TF26071: This work item has been changed by someone else')).kind).toBe('conflict');
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ConnectionRefused'])('treats socket error %s as offline', code => {
    expect(toServeError(socket(code)).kind).toBe('offline');
  });

  it('falls back to internal, keeping the message', () => {
    expect(toServeError(new Error('surprise'))).toEqual({ kind: 'internal', message: 'surprise' });
  });

  it('survives something that is not an Error', () => {
    expect(toServeError('plain string')).toEqual({ kind: 'internal', message: 'plain string' });
    expect(toServeError(undefined).kind).toBe('internal');
  });
});
