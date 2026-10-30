import { afterEach, describe, expect, it } from 'bun:test';
import { parseIds } from '../src/cli/parsers';
import { captureExit, captureStderr } from './helpers';

describe('parseIds', () => {
  let restore: Array<{ mockRestore(): void }> = [];
  afterEach(() => {
    for (const spy of restore) spy.mockRestore();
    restore = [];
  });

  it('reads one id or a comma-separated list', () => {
    expect(parseIds('101')).toEqual([101]);
    expect(parseIds(' 101, 102 ,103 ')).toEqual([101, 102, 103]);
  });

  // A repeated card would be patched twice from the same read and fail its revision test.
  it('drops duplicates', () => {
    expect(parseIds('101,102,101')).toEqual([101, 102]);
  });

  it('exits 1 on an invalid or missing id', () => {
    const stderr = captureStderr();
    restore = [captureExit(), stderr.spy];
    expect(() => parseIds('101,abc')).toThrow('process.exit(1)');
    expect(() => parseIds(' , ')).toThrow('process.exit(1)');
    expect(stderr.lines).toEqual(['Invalid work item ID: abc', 'Missing work item ID']);
  });
});
