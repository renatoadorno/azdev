import { describe, expect, it } from 'bun:test';
import { FIELD_ALIASES, resolveField, resolveFieldOffline, suggestFields } from '../src/services/fieldNames';
import {
  buildOrderBy,
  buildWiql,
  groupCounts,
  inClause,
  isoDay,
  parseSince,
  queryConditions,
  rewriteFieldRefs,
} from '../src/services/queryBuilder';

const KNOWN = [
  { referenceName: 'System.AssignedTo', name: 'Assigned To' },
  { referenceName: 'Microsoft.VSTS.Scheduling.RemainingWork', name: 'Remaining Work' },
  { referenceName: 'Custom.Squad', name: 'Squad' },
  { referenceName: 'Custom.Size', name: 'Size' },
  { referenceName: 'Other.Size', name: 'Tamanho' },
];

describe('field names', () => {
  it('resolves aliases and reference names without the field list', () => {
    expect(resolveFieldOffline('assignedTo')).toBe('System.AssignedTo');
    expect(resolveFieldOffline('closed')).toBe('Microsoft.VSTS.Common.ClosedDate');
    expect(resolveFieldOffline('Custom.Squad')).toBe('Custom.Squad');
    expect(resolveFieldOffline('squad')).toBeUndefined();
  });

  it('every alias points at a reference name', () => {
    expect(Object.values(FIELD_ALIASES).every(ref => /^[A-Z][\w]*(\.[\w]+)+$/.test(ref))).toBe(true);
  });

  it('resolves display names and the last segment against the project fields', () => {
    expect(resolveField('Remaining Work', KNOWN)).toBe('Microsoft.VSTS.Scheduling.RemainingWork');
    expect(resolveField('squad', KNOWN)).toBe('Custom.Squad');
    expect(resolveField('custom.squad', KNOWN)).toBe('Custom.Squad');
    expect(resolveField('nothing', KNOWN)).toBeUndefined();
  });

  it('refuses a name two fields share', () => {
    expect(() => resolveField('size', KNOWN)).toThrow('Field "size" is ambiguous: Custom.Size, Other.Size');
  });

  it('suggests fields containing the name', () => {
    expect(suggestFields('remain', KNOWN)).toEqual(['Microsoft.VSTS.Scheduling.RemainingWork (Remaining Work)']);
  });
});

describe('parseSince', () => {
  const now = new Date(2026, 9, 2, 15, 30); // 2026-10-02 15:30 local

  it('reads relative and absolute days', () => {
    expect(isoDay(parseSince('7d', now))).toBe('2026-09-25');
    expect(isoDay(parseSince('2w', now))).toBe('2026-09-18');
    expect(isoDay(parseSince('1m', now))).toBe('2026-09-02');
    expect(isoDay(parseSince('1y', now))).toBe('2025-10-02');
    expect(isoDay(parseSince('today', now))).toBe('2026-10-02');
    expect(isoDay(parseSince('yesterday', now))).toBe('2026-10-01');
    expect(isoDay(parseSince('2026-08-31', now))).toBe('2026-08-31');
  });

  it('keeps months back inside the target month', () => {
    expect(isoDay(parseSince('1m', new Date(2026, 2, 31)))).toBe('2026-02-28');
    expect(isoDay(parseSince('1y', new Date(2028, 1, 29)))).toBe('2027-02-28');
    expect(isoDay(parseSince('13m', new Date(2026, 0, 15)))).toBe('2024-12-15');
  });

  it('refuses anything else, an impossible date included', () => {
    expect(() => parseSince('last week', now)).toThrow('Invalid date "last week"');
    expect(() => parseSince('2026-02-30', now)).toThrow('Invalid date');
  });
});

describe('WIQL building', () => {
  const resolve = (name: string) => resolveFieldOffline(name) ?? `Custom.${name}`;

  it('resolves short names in a free condition, leaving literals and reference names alone', () => {
    expect(rewriteFieldRefs("[priority] = 1 AND [title] CONTAINS '[PROD]' AND [System.State] <> 'Done'", resolve))
      .toBe("[Microsoft.VSTS.Common.Priority] = 1 AND [System.Title] CONTAINS '[PROD]' AND [System.State] <> 'Done'");
    expect(rewriteFieldRefs("[title] = 'it''s [x]'", resolve)).toBe("[System.Title] = 'it''s [x]'");
    expect(rewriteFieldRefs('[title] CONTAINS "[PROD] it\'s" AND [state] = \'New\'', resolve))
      .toBe('[System.Title] CONTAINS "[PROD] it\'s" AND [System.State] = \'New\'');
  });

  it('builds the order, refusing a bad direction', () => {
    expect(buildOrderBy('changed desc, id', resolve)).toBe('[System.ChangedDate] DESC, [System.Id]');
    expect(() => buildOrderBy('changed down', resolve)).toThrow('Invalid --orderBy "changed down"');
  });

  it('turns the filters into conditions', () => {
    const conditions = queryConditions({
      mine: true,
      types: ['Task', 'Bug Fix'],
      states: ["Won't fix"],
      iterationPath: 'Demo\\Sprint 82',
      areaPath: 'Demo\\Backend',
      tags: ['AWS'],
      text: 'checkout',
      parentId: 14547,
      closedSince: new Date(2026, 8, 1),
      where: '[System.Priority] = 1',
    });
    expect(conditions).toEqual([
      '[System.AssignedTo] = @me',
      "[System.WorkItemType] IN ('Task', 'Bug Fix')",
      "[System.State] = 'Won''t fix'",
      "[System.IterationPath] = 'Demo\\Sprint 82'",
      "[System.AreaPath] UNDER 'Demo\\Backend'",
      "[System.Tags] CONTAINS 'AWS'",
      "([System.Title] CONTAINS 'checkout' OR [System.Description] CONTAINS 'checkout')",
      '[System.Parent] = 14547',
      "[Microsoft.VSTS.Common.ClosedDate] >= '2026-09-01'",
      '([System.Priority] = 1)',
    ]);
  });

  it('treats an @me assignee as the macro and filters unassigned items', () => {
    expect(queryConditions({ assignedTo: '@Me' })).toEqual(['[System.AssignedTo] = @me']);
    expect(queryConditions({ unassigned: true })).toEqual(["[System.AssignedTo] = ''"]);
  });

  it('scopes the query to the project and orders by last change by default', () => {
    expect(buildWiql([inClause('System.State', ['New'])])).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] = 'New' ORDER BY [System.ChangedDate] DESC",
    );
  });

  it('groups rows by several keys, largest group first', () => {
    const rows = [
      { State: 'Done', AssignedTo: 'Ana' },
      { State: 'New', AssignedTo: 'Ana' },
      { State: 'Done', AssignedTo: 'Ana' },
      { State: 'Done' },
    ];
    expect(groupCounts(rows, ['State', 'AssignedTo'])).toEqual([
      { State: 'Done', AssignedTo: 'Ana', count: 2 },
      { State: 'Done', AssignedTo: '', count: 1 },
      { State: 'New', AssignedTo: 'Ana', count: 1 },
    ]);
  });
});
