import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { flowsPath, loadFlows, loadOperationalTypes } from '../src/cli/flows';
import { ExitError, captureExit, captureStderr, cleanupTempConfigs, createEnvGuard, makeTempConfig } from './helpers';

const VALID = {
  operationalTypes: ['meetings'],
  flows: { story: { parentTypes: ['Product Backlog Item'], cards: [{ key: 'impl', type: 'Task', title: '{title}' }] } },
};

let env = createEnvGuard();
let exit = captureExit();
let stderr = captureStderr();

beforeEach(() => {
  env = createEnvGuard();
  env.set('AZDEV_CONFIG_PATH', makeTempConfig({ orgUrl: 'https://dev.azure.com/acme', project: 'Demo' }));
  exit = captureExit();
  stderr = captureStderr();
});

afterEach(() => {
  env.restore();
  exit.mockRestore();
  stderr.spy.mockRestore();
  cleanupTempConfigs();
});

function writeFlows(contents: unknown) {
  fs.writeFileSync(flowsPath(), typeof contents === 'string' ? contents : JSON.stringify(contents));
}

function expectExit2(fn: () => unknown) {
  expect(fn).toThrow(ExitError);
  expect(exit).toHaveBeenCalledWith(2);
}

describe('flows file', () => {
  it('lives next to config.json, so AZDEV_CONFIG_PATH isolates it too', () => {
    expect(path.dirname(flowsPath())).toBe(path.dirname(process.env.AZDEV_CONFIG_PATH!));
    expect(path.basename(flowsPath())).toBe('flows.json');
  });

  it('loads a valid file', () => {
    writeFlows(VALID);
    expect(loadFlows()).toEqual(VALID);
  });

  it('exits 2 with a hint when the file is missing', () => {
    expectExit2(() => loadFlows());
    expect(stderr.text()).toContain('No flows defined');
  });

  it('exits 2 when the file is not JSON', () => {
    writeFlows('{ nope');
    expectExit2(() => loadFlows());
    expect(stderr.text()).toContain('not valid JSON');
  });

  it('exits 2 listing the problems of an invalid file', () => {
    writeFlows({ flows: { story: { cards: [{ key: 'impl', type: 'Task' }] } } });
    expectExit2(() => loadFlows());
    expect(stderr.text()).toContain('"title" is required');
  });

  it('reads operationalTypes, and none when there is no file', () => {
    expect(loadOperationalTypes()).toEqual([]);
    writeFlows(VALID);
    expect(loadOperationalTypes()).toEqual(['meetings']);
  });
});
