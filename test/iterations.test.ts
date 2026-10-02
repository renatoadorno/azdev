import { describe, expect, it } from 'bun:test';
import {
  flattenIterations,
  matchIteration,
  suggestIterations,
  toFieldPath,
  type SlimIterationNode,
} from '../src/services/iterations';

const ITERATIONS: SlimIterationNode[] = [
  { id: 'root-guid', name: 'Demo', path: 'Demo' },
  { id: '0a50-sprint-1', name: 'Sprint 1', path: 'Demo\\Sprint 1' },
  { id: '6a01-sprint-82', name: 'Sprint 82', path: 'Demo\\Sprint 82' },
  { id: 'a171-sprint-100', name: 'Sprint 100', path: 'Demo\\Sprint 100' },
];

describe('matchIteration', () => {
  it('finds a sprint by its bare number', () => {
    expect(matchIteration('82', ITERATIONS)?.path).toBe('Demo\\Sprint 82');
  });

  it('does not confuse Sprint 1 with Sprint 100', () => {
    expect(matchIteration('1', ITERATIONS)?.path).toBe('Demo\\Sprint 1');
    expect(matchIteration('100', ITERATIONS)?.path).toBe('Demo\\Sprint 100');
  });

  it('ignores leading zeros in a bare number', () => {
    expect(matchIteration('082', ITERATIONS)?.path).toBe('Demo\\Sprint 82');
  });

  it('finds a sprint by exact name, case-insensitive', () => {
    expect(matchIteration('sprint 82', ITERATIONS)?.id).toBe('6a01-sprint-82');
  });

  it('finds a sprint by full path and by GUID', () => {
    expect(matchIteration('demo\\sprint 100', ITERATIONS)?.name).toBe('Sprint 100');
    expect(matchIteration('6A01-SPRINT-82', ITERATIONS)?.name).toBe('Sprint 82');
  });

  it('returns undefined for an unknown sprint or an empty value', () => {
    expect(matchIteration('999', ITERATIONS)).toBeUndefined();
    expect(matchIteration('Sprint X', ITERATIONS)).toBeUndefined();
    expect(matchIteration('   ', ITERATIONS)).toBeUndefined();
  });

  it('refuses a bare number that matches two iterations', () => {
    const twoTeams = [...ITERATIONS, { id: 'x', name: 'Mobile 82', path: 'Demo\\Mobile\\Mobile 82' }];
    expect(() => matchIteration('82', twoTeams)).toThrow('ambiguous');
  });

  it('refuses a name shared by two iterations instead of picking the first', () => {
    const twoYears = [
      { id: 'a', name: 'Sprint 1', path: 'Demo\\2025\\Sprint 1' },
      { id: 'b', name: 'Sprint 1', path: 'Demo\\2026\\Sprint 1' },
    ];
    expect(() => matchIteration('Sprint 1', twoYears)).toThrow('ambiguous: Demo\\2025\\Sprint 1, Demo\\2026\\Sprint 1');
    expect(matchIteration('Demo\\2026\\Sprint 1', twoYears)?.id).toBe('b');
  });

  it('prefers an exact name over a number match', () => {
    const named = [...ITERATIONS, { id: 'n', name: '82', path: 'Demo\\82' }];
    expect(matchIteration('82', named)?.path).toBe('Demo\\82');
  });
});

describe('suggestIterations', () => {
  it('suggests names sharing the number of a miss', () => {
    expect(suggestIterations('Sprnt 82', ITERATIONS)).toEqual(['Sprint 82']);
  });
});

describe('toFieldPath / flattenIterations', () => {
  it('strips the structural Iteration segment from classification paths', () => {
    expect(toFieldPath('\\Demo\\Iteration\\Sprint 82')).toBe('Demo\\Sprint 82');
    expect(toFieldPath('\\Demo\\Iteration')).toBe('Demo');
  });

  it('keeps the node identifier as id, so a team iteration GUID resolves', () => {
    const flat = flattenIterations({
      identifier: 'root',
      name: 'Demo',
      path: '\\Demo\\Iteration',
      children: [{ identifier: 'g-82', name: 'Sprint 82', path: '\\Demo\\Iteration\\Sprint 82', attributes: { startDate: '2026-09-21' } }],
    } as any);
    expect(flat).toEqual([
      { id: 'root', name: 'Demo', path: 'Demo', startDate: undefined, finishDate: undefined },
      { id: 'g-82', name: 'Sprint 82', path: 'Demo\\Sprint 82', startDate: '2026-09-21', finishDate: undefined },
    ]);
  });
});
