import { describe, expect, it } from 'bun:test';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import {
  buildFilterClauses,
  fieldOperations,
  idFromWorkItemUrl,
  parentChange,
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

  describe('parentChange', () => {
    const ORG = 'https://dev.azure.com/acme';
    const rel = (type: string, id: number) => ({ rel: type, url: `${ORG}/b3f9/_apis/wit/workItems/${id}` });
    const card = (...relations: Array<ReturnType<typeof rel>>) => ({ id: 7, rev: 12, relations });
    const linkTo = (id: number) => parentRelationOperation(ORG, id);

    it('removes the current parent by its position and links the new one, guarded by the revision', () => {
      const item = card(rel('System.LinkTypes.Related', 3), rel('System.LinkTypes.Hierarchy-Forward', 4), rel('System.LinkTypes.Hierarchy-Reverse', 100));
      expect(parentChange(item, ORG, 200)).toEqual({
        from: 100,
        operations: [
          { op: Operation.Test, path: '/rev', value: 12 },
          { op: Operation.Remove, path: '/relations/2' },
          linkTo(200),
        ],
      });
    });

    it('only links a card that has no parent', () => {
      expect(parentChange(card(rel('System.LinkTypes.Related', 3)), ORG, 200)).toEqual({
        from: undefined,
        operations: [{ op: Operation.Test, path: '/rev', value: 12 }, linkTo(200)],
      });
      expect(parentChange({ id: 7, rev: 1 }, ORG, 200).operations).toHaveLength(2);
    });

    it('only unlinks when no new parent is given', () => {
      expect(parentChange(card(rel('System.LinkTypes.Hierarchy-Reverse', 100)), ORG)).toEqual({
        from: 100,
        operations: [{ op: Operation.Test, path: '/rev', value: 12 }, { op: Operation.Remove, path: '/relations/0' }],
      });
    });

    it('sends nothing when the card already hangs where asked', () => {
      expect(parentChange(card(rel('System.LinkTypes.Hierarchy-Reverse', 200)), ORG, 200)).toEqual({ from: 200, operations: [] });
      expect(parentChange(card(), ORG)).toEqual({ from: undefined, operations: [] });
    });
  });

  it('reads the id back from a relation url', () => {
    expect(idFromWorkItemUrl('https://dev.azure.com/acme/b3f9/_apis/wit/workItems/13298')).toBe(13298);
    expect(idFromWorkItemUrl('vstfs:///Git/PullRequestId/x%2Fy%2F66')).toBeUndefined();
    expect(idFromWorkItemUrl(undefined)).toBeUndefined();
  });
});
