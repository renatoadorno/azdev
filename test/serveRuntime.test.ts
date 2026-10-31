import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import {
  acquireServeLock,
  cacheDir,
  generateToken,
  isServeLockHeld,
  readServeInfo,
  removeServeInfo,
  serveInfoPath,
  tokensEqual,
  writeServeInfo,
  type ServeInfo,
} from '../src/serve/runtime';
import { cleanupTempConfigs, createEnvGuard, fileMode, makeTempConfig } from './helpers';

let env = createEnvGuard();

beforeEach(() => {
  env = createEnvGuard();
  env.set('AZDEV_CONFIG_PATH', makeTempConfig(null));
});

afterEach(() => {
  env.restore();
  cleanupTempConfigs();
});

const info = (overrides: Partial<ServeInfo> = {}): ServeInfo => ({
  pid: process.pid,
  port: 50129,
  token: 'a'.repeat(64),
  version: '0.11.0',
  proto: 1,
  startedAt: '2026-10-31T22:00:00.000Z',
  ...overrides,
});

describe('serve.json', () => {
  it('lives next to config.json, readable only by the user', () => {
    writeServeInfo(info());
    expect(serveInfoPath()).toBe(`${process.env.AZDEV_CONFIG_PATH!.replace(/config\.json$/, '')}serve.json`);
    expect(fileMode(serveInfoPath())).toBe(0o600);
  });

  it('round-trips and leaves no temporary file behind', () => {
    writeServeInfo(info());
    expect(readServeInfo()).toEqual(info());
    const dir = serveInfoPath().replace(/serve\.json$/, '');
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });

  it('reads as null when missing, malformed or not written by azdev', () => {
    expect(readServeInfo()).toBeNull();
    fs.writeFileSync(serveInfoPath(), '{ nope');
    expect(readServeInfo()).toBeNull();
    fs.writeFileSync(serveInfoPath(), JSON.stringify({ port: '1' }));
    expect(readServeInfo()).toBeNull();
  });

  it('is removed only by the daemon it names, never one started after it', () => {
    writeServeInfo(info({ pid: 999_999 }));
    removeServeInfo(process.pid);
    expect(readServeInfo()?.pid).toBe(999_999);
    removeServeInfo(999_999);
    expect(readServeInfo()).toBeNull();
  });
});

describe('token', () => {
  it('is 256 random bits in hex, different each time', () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(generateToken()).not.toBe(token);
  });

  it('compares only an exact string', () => {
    const token = generateToken();
    expect(tokensEqual(token, token)).toBe(true);
    expect(tokensEqual(token.slice(1), token)).toBe(false);
    expect(tokensEqual(`${token.slice(0, -1)}0`.replace(/.$/, token.endsWith('0') ? '1' : '0'), token)).toBe(false);
    expect(tokensEqual(undefined, token)).toBe(false);
    expect(tokensEqual(123, token)).toBe(false);
  });
});

describe('lock', () => {
  it('lets only one holder in, and frees on release', () => {
    const first = acquireServeLock();
    expect(first).not.toBeNull();
    expect(acquireServeLock()).toBeNull();
    expect(isServeLockHeld()).toBe(true);

    first!.release();
    expect(isServeLockHeld()).toBe(false);
    const again = acquireServeLock();
    expect(again).not.toBeNull();
    again!.release();
  });
});

describe('cacheDir', () => {
  it('prefers AZDEV_CACHE_DIR, then XDG_CACHE_HOME, then ~/.cache', () => {
    env.set('AZDEV_CACHE_DIR', '/tmp/azdev-cache');
    expect(cacheDir()).toBe('/tmp/azdev-cache');
    env.set('AZDEV_CACHE_DIR', undefined);
    env.set('XDG_CACHE_HOME', '/tmp/xdg-cache');
    expect(cacheDir()).toBe('/tmp/xdg-cache/azdev');
    env.set('XDG_CACHE_HOME', undefined);
    expect(cacheDir()).toBe(`${process.env.HOME}/.cache/azdev`);
  });
});
