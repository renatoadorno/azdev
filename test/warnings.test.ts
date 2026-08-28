import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { silenceDependencyWarnings } from '../src/cli/warnings';

let original: typeof process.emitWarning;
let seen: string[];

beforeEach(() => {
  original = process.emitWarning;
  seen = [];
  // Stand in for Node's printer so the assertions observe what would reach stderr.
  process.emitWarning = ((warning: unknown) => {
    seen.push(String((warning as Error)?.message ?? warning));
  }) as typeof process.emitWarning;

  silenceDependencyWarnings();
});

afterEach(() => {
  process.emitWarning = original;
});

describe('silenceDependencyWarnings', () => {
  it('drops DEP0169 passed as the positional code argument', () => {
    process.emitWarning('url.parse is deprecated', 'DeprecationWarning', 'DEP0169');
    expect(seen).toEqual([]);
  });

  it('drops DEP0169 passed in the options object', () => {
    process.emitWarning('url.parse is deprecated', { type: 'DeprecationWarning', code: 'DEP0169' });
    expect(seen).toEqual([]);
  });

  it('drops DEP0169 carried on an Error', () => {
    const err = Object.assign(new Error('url.parse is deprecated'), { code: 'DEP0169' });
    process.emitWarning(err);
    expect(seen).toEqual([]);
  });

  it('lets a different deprecation through', () => {
    process.emitWarning('something else', 'DeprecationWarning', 'DEP0040');
    expect(seen).toEqual(['something else']);
  });

  it('lets an uncoded warning through', () => {
    process.emitWarning('plain warning');
    expect(seen).toEqual(['plain warning']);
  });
});
