import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { inboxStatePath, readLastCheck, saveLastCheck } from '../src/cli/inboxState';
import { captureStderr, cleanupTempConfigs, createEnvGuard, makeTempConfig } from './helpers';

let env = createEnvGuard();
let stderr = captureStderr();
let configFile = '';

beforeEach(() => {
  env = createEnvGuard();
  configFile = makeTempConfig({ orgUrl: 'https://dev.azure.com/acme', project: 'Demo' });
  env.set('AZDEV_CONFIG_PATH', configFile);
  stderr = captureStderr();
});

afterEach(() => {
  env.restore();
  stderr.spy.mockRestore();
  cleanupTempConfigs();
});

describe('inbox state', () => {
  it('lives next to config.json, so AZDEV_CONFIG_PATH isolates it too', () => {
    expect(inboxStatePath()).toBe(path.join(path.dirname(configFile), 'inbox.json'));
  });

  it('has no last check before the first one', () => {
    expect(readLastCheck('Demo')).toBeUndefined();
  });

  it('keeps the last check per project', () => {
    saveLastCheck('Demo', new Date('2026-10-06T12:00:00.000Z'));
    saveLastCheck('Other', new Date('2026-10-05T08:00:00.000Z'));
    saveLastCheck('Demo', new Date('2026-10-06T15:30:00.000Z'));

    expect(readLastCheck('Demo')).toBe('2026-10-06T15:30:00.000Z');
    expect(readLastCheck('Other')).toBe('2026-10-05T08:00:00.000Z');
  });

  it('warns and starts over when the file is not valid JSON', () => {
    fs.writeFileSync(inboxStatePath(), '{ broken');
    expect(readLastCheck('Demo')).toBeUndefined();
    expect(stderr.text()).toContain('is not valid JSON');

    saveLastCheck('Demo', new Date('2026-10-06T12:00:00.000Z'));
    expect(readLastCheck('Demo')).toBe('2026-10-06T12:00:00.000Z');
  });
});
