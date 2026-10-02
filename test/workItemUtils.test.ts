import { describe, expect, it } from 'bun:test';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import {
  buildFilterClauses,
  fieldOperations,
  idFromWorkItemUrl,
  parentRelationOperation,
  parseTags,
} from '../src/services/workItemUtils';

describe('buildFilterClauses', () => {
  it('builds one clause per filter', () => {
    expect(buildFilterClauses({ mine: true, state: 'Done', type: 'Task' })).toEqual([
      '[System.AssignedTo] = @me',
      "[System.State] = 'Done'",
      "[System.WorkItemType] = 'Task'",
    ]);
  });

  it('turns assignedTo @me into the unquoted WIQL macro', () => {
    expect(buildFilterClauses({ assignedTo: '@me' })).toEqual(['[System.AssignedTo] = @me']);
    expect(buildFilterClauses({ assignedTo: ' @ME ' })).toEqual(['[System.AssignedTo] = @me']);
  });

  it('lets mine win over assignedTo', () => {
    expect(buildFilterClauses({ mine: true, assignedTo: 'alice@x.dev' })).toEqual(['[System.AssignedTo] = @me']);
  });

  it('escapes quotes so a value cannot break out of the WIQL literal', () => {
    expect(buildFilterClauses({ assignedTo: "O'Brien", type: "x' OR '1'='1" })).toEqual([
      "[System.AssignedTo] = 'O''Brien'",
      "[System.WorkItemType] = 'x'' OR ''1''=''1'",
    ]);
  });

  it('excludes every finished state for openOnly', () => {
    expect(buildFilterClauses({ openOnly: true })).toEqual([
      "[System.State] NOT IN ('Done', 'Closed', 'Removed', 'Completed')",
    ]);
  });

  it('qualifies fields with a scope for link queries', () => {
    expect(buildFilterClauses({ mine: true }, 'Target')).toEqual(['[Target].[System.AssignedTo] = @me']);
  });

  it('returns nothing without filters', () => {
    expect(buildFilterClauses({})).toEqual([]);
  });
});

describe('parseTags', () => {
  it('accepts ; and , and joins in the System.Tags wire format', () => {
    expect(parseTags('AWS, Área Web;Mobile')).toBe('AWS; Área Web; Mobile');
  });

  it('drops blanks and duplicates', () => {
    expect(parseTags(['a', ' a ', '', 'b'])).toBe('a; b');
  });

  it('returns undefined when there is no tag', () => {
    expect(parseTags(' ; , ')).toBeUndefined();
    expect(parseTags(undefined)).toBeUndefined();
  });
});

describe('fieldOperations', () => {
  it('sets each defined field and skips undefined ones', () => {
    expect(fieldOperations({ 'System.Title': 'T', 'System.State': undefined })).toEqual([
      { op: Operation.Add, path: '/fields/System.Title', value: 'T' },
    ]);
  });

  it('keeps an explicit empty string, so update can clear a field', () => {
    expect(fieldOperations({ 'System.Tags': '' })).toEqual([{ op: Operation.Add, path: '/fields/System.Tags', value: '' }]);
  });

  it('marks only the multiline fields being written with the format', () => {
    const ops = fieldOperations({ 'System.Title': 'T', 'System.Description': '## d' }, 'markdown');
    expect(ops).toContainEqual({ op: Operation.Add, path: '/multilineFieldsFormat/System.Description', value: 'Markdown' });
    expect(ops.filter(op => op.path.startsWith('/multilineFieldsFormat/'))).toHaveLength(1);
  });

  it('writes Html for the html format and no marker without a format', () => {
    expect(fieldOperations({ 'System.Description': '<b>d</b>' }, 'html')).toContainEqual({
      op: Operation.Add,
      path: '/multilineFieldsFormat/System.Description',
      value: 'Html',
    });
    expect(fieldOperations({ 'System.Description': 'd' })).toHaveLength(1);
  });

  it('does not mark a multiline field that is not being written', () => {
    expect(fieldOperations({ 'System.Description': undefined }, 'markdown')).toEqual([]);
  });
});

describe('work item relations', () => {
  it('links to the parent through Hierarchy-Reverse', () => {
    expect(parentRelationOperation('https://dev.azure.com/acme', 14547)).toEqual({
      op: Operation.Add,
      path: '/relations/-',
      value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/acme/_apis/wit/workItems/14547' },
    });
  });

  it('reads the id back from a relation url', () => {
    expect(idFromWorkItemUrl('https://dev.azure.com/acme/b3f9/_apis/wit/workItems/13298')).toBe(13298);
    expect(idFromWorkItemUrl('vstfs:///Git/PullRequestId/x%2Fy%2F66')).toBeUndefined();
    expect(idFromWorkItemUrl(undefined)).toBeUndefined();
  });
});
