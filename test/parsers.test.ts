import { afterEach, describe, expect, it } from 'bun:test';
import { parseDuration, parseIds } from '../src/cli/parsers';
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

describe('parseDuration', () => {
  let restore: Array<{ mockRestore(): void }> = [];
  afterEach(() => {
    for (const spy of restore) spy.mockRestore();
    restore = [];
  });

  it('reads ms, s, m and h, and a bare 0', () => {
    expect(parseDuration('0', '--idleExit')).toBe(0);
    expect(parseDuration('500ms', '--idleExit')).toBe(500);
    expect(parseDuration('30s', '--idleExit')).toBe(30_000);
    expect(parseDuration('30m', '--idleExit')).toBe(1_800_000);
    expect(parseDuration(' 2h ', '--idleExit')).toBe(7_200_000);
  });

  // A bare number is ambiguous (seconds? minutes?), so only 0 may go without a unit.
  it('exits 1 on a bare non-zero number, a negative or an unknown unit', () => {
    const stderr = captureStderr();
    restore = [captureExit(), stderr.spy];
    for (const value of ['90', '-1m', '2d', 'soon']) expect(() => parseDuration(value, '--idleExit')).toThrow('process.exit(1)');
    expect(stderr.lines[0]).toBe('Invalid --idleExit: 90 (use 0, 30s, 30m or 2h)');
  });
});
