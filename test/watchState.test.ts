import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { readWatch, updateWatch, watchStatePath } from '../src/cli/watchState';
import { addWatch } from '../src/services/watch';
import { cleanupTempConfigs, createEnvGuard, makeTempConfig } from './helpers';

const AT = new Date('2026-10-06T12:00:00.000Z');

let env = createEnvGuard();
let configFile = '';

beforeEach(() => {
  env = createEnvGuard();
  configFile = makeTempConfig({ orgUrl: 'https://dev.azure.com/acme', project: 'Demo' });
  env.set('AZDEV_CONFIG_PATH', configFile);
});

afterEach(() => {
  env.restore();
  cleanupTempConfigs();
});

describe('watch state', () => {
  it('lives next to config.json, so AZDEV_CONFIG_PATH isolates it too', () => {
    expect(watchStatePath()).toBe(path.join(path.dirname(configFile), 'watch.json'));
  });

  it('watches nothing before the first card', () => {
    expect(readWatch('Demo')).toEqual({ watching: [], archived: [] });
  });

  it('keeps one list per project and returns the one it changed', () => {
    updateWatch('Demo', list => addWatch(list, 14547, AT));
    const other = updateWatch('Other', list => addWatch(list, 900, AT));

    expect(other).toEqual({ watching: [{ id: 900, since: AT.toISOString() }], archived: [] });
    expect(readWatch('Demo')).toEqual({ watching: [{ id: 14547, since: AT.toISOString() }], archived: [] });
    expect(fs.readdirSync(path.dirname(configFile)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a malformed file and leaves it untouched', () => {
    fs.writeFileSync(watchStatePath(), '{ broken');
    expect(() => readWatch('Demo')).toThrow('is not valid JSON');
    expect(() => updateWatch('Demo', list => addWatch(list, 1, AT))).toThrow('is not valid JSON');
    expect(fs.readFileSync(watchStatePath(), 'utf-8')).toBe('{ broken');
  });
});
