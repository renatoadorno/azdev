import { describe, expect, it } from 'bun:test';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { CommentFormat, WorkItemErrorPolicy } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { AzureDevOpsConfig } from '../src/interfaces/AzureDevOps';
import { WorkItemService } from '../src/services/WorkItemService';

const ORG = 'https://dev.azure.com/acme';

/**
 * A WorkItemService wired to an in-memory fake of the SDK surface it uses, so the
 * request it builds can be asserted without the network.
 */
function makeService(overrides: Record<string, unknown> = {}, config: Partial<AzureDevOpsConfig> = {}) {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => (calls[name] ??= []).push(args);

  const witApi = {
    getWorkItem: async (...args: unknown[]) => {
      record('getWorkItem', args);
      return { id: args[0], fields: { 'System.AreaPath': 'Demo\\Backend', 'System.IterationPath': 'Demo\\Sprint 82', 'System.WorkItemType': 'Issue' } };
    },
    getClassificationNode: async () => ({
      identifier: 'root',
      name: 'Demo',
      path: '\\Demo\\Iteration',
      children: [{ identifier: 'g-100', name: 'Sprint 100', path: '\\Demo\\Iteration\\Sprint 100' }],
    }),
    createWorkItem: async (...args: unknown[]) => {
      record('createWorkItem', args);
      return { id: 1, fields: {} };
    },
    updateWorkItem: async (...args: unknown[]) => {
      record('updateWorkItem', args);
      return { id: args[2], fields: {} };
    },
    getWorkItemTypeStates: async (...args: unknown[]) => {
      record('getWorkItemTypeStates', args);
      return [{ name: 'New' }, { name: 'Committed' }, { name: 'Done' }];
    },
    addComment: async (...args: unknown[]) => {
      record('addComment', args);
      return { id: 9, format: CommentFormat.Html };
    },
    vsoClient: {
      getVersioningData: async (...args: unknown[]) => {
        record('getVersioningData', args);
        return { apiVersion: '7.1-preview.4', requestUrl: `${ORG}/Demo/_apis/wit/workItems/7/comments?format=markdown` };
      },
    },
    createRequestOptions: () => ({}),
    rest: {
      create: async (...args: unknown[]) => {
        record('rest.create', args);
        return { result: { id: 10, format: 'markdown', text: (args[1] as { text: string }).text } };
      },
    },
    formatResponse: (data: { format: string }) => ({ ...data, format: data.format === 'markdown' ? CommentFormat.Markdown : CommentFormat.Html }),
    ...overrides,
  };

  const svc = new WorkItemService({ orgUrl: ORG, project: 'Demo', personalAccessToken: 'tok', auth: { type: 'pat' }, ...config });
  (svc as any).connection = {
    getWorkItemTrackingApi: async () => witApi,
    connect: async () => ({ authenticatedUser: { properties: { Account: { $value: 'me@acme.dev' } } } }),
  };
  return { svc, calls };
}

const fieldValue = (ops: Array<{ path?: string; value?: unknown }>, ref: string) => ops.find(op => op.path === `/fields/${ref}`)?.value;

describe('WorkItemService.buildCreateRequest', () => {
  it('puts parent link, tags, sprint and @me in a single request', async () => {
    const { svc } = makeService();
    const { workItemType, operations } = await svc.buildCreateRequest({
      workItemType: 'technical tests',
      title: 'Testes',
      parentId: 14547,
      tags: 'AWS, Backend',
      sprint: '100',
      assignedTo: '@me',
    });

    expect(workItemType).toBe('technical tests');
    expect(fieldValue(operations, 'System.Tags')).toBe('AWS; Backend');
    expect(fieldValue(operations, 'System.IterationPath')).toBe('Demo\\Sprint 100');
    expect(fieldValue(operations, 'System.AssignedTo')).toBe('me@acme.dev');
    expect(operations).toContainEqual({
      op: Operation.Add,
      path: '/relations/-',
      value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${ORG}/_apis/wit/workItems/14547` },
    });
  });

  it('inherits area and sprint from the parent when not given', async () => {
    const { svc } = makeService();
    const { operations } = await svc.buildCreateRequest({ workItemType: 'Task', title: 'T', parentId: 5 });
    expect(fieldValue(operations, 'System.AreaPath')).toBe('Demo\\Backend');
    expect(fieldValue(operations, 'System.IterationPath')).toBe('Demo\\Sprint 82');
  });

  it('inherits only the missing half: an explicit sprint survives the parent', async () => {
    const { svc } = makeService();
    const { operations } = await svc.buildCreateRequest({ workItemType: 'Task', title: 'T', parentId: 5, sprint: 'Sprint 100' });
    expect(fieldValue(operations, 'System.AreaPath')).toBe('Demo\\Backend');
    expect(fieldValue(operations, 'System.IterationPath')).toBe('Demo\\Sprint 100');
  });

  it('inherits only the missing half: an explicit area survives the parent', async () => {
    const { svc } = makeService();
    const { operations } = await svc.buildCreateRequest({ workItemType: 'Task', title: 'T', parentId: 5, areaPath: 'Demo\\Mobile' });
    expect(fieldValue(operations, 'System.AreaPath')).toBe('Demo\\Mobile');
    expect(fieldValue(operations, 'System.IterationPath')).toBe('Demo\\Sprint 82');
  });

  it('does not read the parent when area and sprint are both given', async () => {
    const { svc, calls } = makeService();
    await svc.buildCreateRequest({ workItemType: 'Task', title: 'T', parentId: 5, areaPath: 'Demo', iterationPath: 'Demo\\Sprint 82' });
    expect(calls.getWorkItem).toBeUndefined();
  });

  it('marks the description with the configured richTextFormat when --format is absent', async () => {
    const { svc } = makeService({}, { richTextFormat: 'markdown' });
    const { operations } = await svc.buildCreateRequest({ workItemType: 'Task', title: 'T', description: '## d' });
    expect(operations).toContainEqual({ op: Operation.Add, path: '/multilineFieldsFormat/System.Description', value: 'Markdown' });
  });

  it('lets an explicit --format win over the configured one', async () => {
    const { svc } = makeService({}, { richTextFormat: 'markdown' });
    const { operations } = await svc.buildCreateRequest({ workItemType: 'Task', title: 'T', description: '<b>d</b>', format: 'html' });
    expect(operations).toContainEqual({ op: Operation.Add, path: '/multilineFieldsFormat/System.Description', value: 'Html' });
  });

  it('fails on an unknown sprint before sending anything', async () => {
    const { svc, calls } = makeService();
    await expect(svc.buildCreateRequest({ workItemType: 'Task', title: 'T', sprint: '999' })).rejects.toThrow('Sprint "999" not found');
    expect(calls.createWorkItem).toBeUndefined();
  });
});

describe('WorkItemService — description written from a template', () => {
  const model = { name: 'Publication', content: '## PRs\n\n## Janela — {parentTitle}\n\n## Critérios de aceite\n' };
  const written = '## PRs\n- api: https://x/pr/1\n\n## Janela — Story\n1. deploy\n\n## Critérios de aceite\n- no ar';

  it('refuses a card with no description when its type has a template', async () => {
    const { svc, calls } = makeService();
    await expect(svc.createWorkItem({ workItemType: 'Publication', title: 'P', descriptionModel: model })).rejects.toThrow(
      'follows the "Publication" template',
    );
    expect(calls.createWorkItem).toBeUndefined();
  });

  it('refuses the untouched template, filled with the parent title', async () => {
    const { svc, calls } = makeService({
      getWorkItem: async () => ({ id: 5, fields: { 'System.Title': 'Demo story', 'System.AreaPath': 'Demo', 'System.IterationPath': 'Demo\\Sprint 82' } }),
    });
    const untouched = '## PRs\n\n## Janela — Demo story\n\n## Critérios de aceite';
    await expect(svc.createWorkItem({ workItemType: 'Publication', title: 'P', parentId: 5, description: untouched, descriptionModel: model }))
      .rejects.toThrow('untouched "Publication" template');
    expect(calls.createWorkItem).toBeUndefined();
  });

  it('accepts written content as Markdown and warns about a section left out', async () => {
    const { svc } = makeService();
    const partial = '## PRs\n- api: https://x/pr/1';
    const { operations, warnings } = await svc.buildCreateRequest({ workItemType: 'Publication', title: 'P', description: partial, descriptionModel: model });
    expect(fieldValue(operations, 'System.Description')).toBe(partial);
    expect(operations).toContainEqual({ op: Operation.Add, path: '/multilineFieldsFormat/System.Description', value: 'Markdown' });
    expect(warnings).toEqual(['The description leaves out sections of the "Publication" template: Janela —, Critérios de aceite']);
  });

  it('reads the parent only when the template needs its title', async () => {
    const needsTitle = makeService();
    await needsTitle.svc.buildCreateRequest({
      workItemType: 'Publication', title: 'P', parentId: 5, areaPath: 'Demo', iterationPath: 'Demo\\Sprint 82', description: written, descriptionModel: model,
    });
    expect(needsTitle.calls.getWorkItem?.[0]?.[1]).toEqual(['System.AreaPath', 'System.IterationPath', 'System.Title']);

    const noTitle = makeService();
    await noTitle.svc.buildCreateRequest({
      workItemType: 'Publication', title: 'P', parentId: 5, areaPath: 'Demo', iterationPath: 'Demo\\Sprint 82',
      description: written, descriptionModel: { name: 'Publication', content: '## PRs\n' },
    });
    expect(noTitle.calls.getWorkItem).toBeUndefined();
  });
});

describe('WorkItemService — invalid state', () => {
  const ruleError = Object.assign(new Error('TF401320: Rule Error for field State'), { statusCode: 400 });

  it('turns the API rule error into the list of valid states for the type', async () => {
    const { svc } = makeService({ updateWorkItem: async () => { throw ruleError; } });
    await expect(svc.updateWorkItemState({ id: 7, state: 'Removed' })).rejects.toThrow(
      'State "Removed" is not valid for Issue. Valid states: New, Committed, Done',
    );
  });

  it('keeps the original error when the state was valid', async () => {
    const { svc } = makeService({ updateWorkItem: async () => { throw ruleError; } });
    await expect(svc.updateWorkItemState({ id: 7, state: 'done' })).rejects.toBe(ruleError);
  });

  it('uses the type being created, without reading any work item', async () => {
    const { svc, calls } = makeService({ createWorkItem: async () => { throw ruleError; } });
    await expect(svc.createWorkItem({ workItemType: 'Reports', title: 'T', state: 'Removed' })).rejects.toThrow('not valid for Reports');
    expect(calls.getWorkItem).toBeUndefined();
    expect(calls.getWorkItemTypeStates![0]).toEqual(['Demo', 'Reports']);
  });
});

describe('WorkItemService.addWorkItemComment', () => {
  it('posts Markdown through the versioned endpoint that accepts format', async () => {
    const { svc, calls } = makeService();
    const comment = await svc.addWorkItemComment({ id: 7, text: 'linha 1\n\n#14041', format: 'markdown' });

    expect(calls.getVersioningData![0]).toEqual([
      '7.1-preview.4',
      'wit',
      '608aac0a-32e1-4493-a863-b9cf4566d257',
      { project: 'Demo', workItemId: 7 },
      { format: 'markdown' },
    ]);
    expect(calls['rest.create']![0]![1]).toEqual({ text: 'linha 1\n\n#14041' });
    expect(calls.addComment).toBeUndefined();
    expect(comment.format).toBe(CommentFormat.Markdown);
  });

  it('follows the configured richTextFormat when --format is absent', async () => {
    const { calls, svc } = makeService({}, { richTextFormat: 'markdown' });
    await svc.addWorkItemComment({ id: 7, text: 'x' });
    expect(calls['rest.create']).toHaveLength(1);
  });

  it('keeps the SDK HTML path by default', async () => {
    const { svc, calls } = makeService();
    await svc.addWorkItemComment({ id: 7, text: '<div>x</div>' });
    expect(calls.addComment![0]).toEqual([{ text: '<div>x</div>' }, 'Demo', 7]);
    expect(calls['rest.create']).toBeUndefined();
  });
});

describe('WorkItemService — missing work items', () => {
  // typed-rest-client resolves a 404 as null instead of rejecting.
  it('says "not found" for the comments of a missing item instead of a TypeError', async () => {
    const { svc } = makeService({ getComments: async () => null });
    await expect(svc.getComments({ id: 99999 })).rejects.toThrow('Work item 99999 not found');
  });

  it('says "not found" for the history of a missing item', async () => {
    const { svc } = makeService({ getRevisions: async () => null });
    await expect(svc.getWorkItemHistory({ id: 99999 })).rejects.toThrow('Work item 99999 not found');
  });

  it('pages through revisions so an old item keeps its latest changes', async () => {
    const pages: number[][] = [];
    const { svc } = makeService({
      getRevisions: async (_id: number, top: number, skip: number) => {
        pages.push([top, skip]);
        const total = 205;
        return Array.from({ length: Math.max(0, Math.min(top, total - skip)) }, (_, i) => ({ rev: skip + i + 1 }));
      },
    });
    const revisions = await svc.getWorkItemHistory({ id: 1 });
    expect(revisions).toHaveLength(205);
    expect(revisions.at(-1)).toEqual({ rev: 205 });
    expect(pages).toEqual([[200, 0], [200, 200]]);
  });

  it('hydrates with the Omit policy and drops unreadable items instead of failing the batch', async () => {
    const calls: unknown[][] = [];
    const { svc } = makeService({
      getWorkItems: async (...args: unknown[]) => {
        calls.push(args);
        return [{ id: 1, fields: { 'System.Title': 'ok' } }, null];
      },
    });
    expect(await (svc as any).hydrate([1, 2])).toEqual([{ id: 1, Title: 'ok' }]);
    expect(calls[0]![4]).toBe(WorkItemErrorPolicy.Omit);
  });

  it('hydrates to nothing when the whole batch comes back as a 404', async () => {
    const { svc } = makeService({ getWorkItems: async () => null });
    expect(await (svc as any).hydrate([99999])).toEqual([]);
  });
});

describe('WorkItemService.queryWorkItems', () => {
  const ITEMS: Record<number, Record<string, unknown>> = {
    1: { 'System.State': 'Done', 'System.AssignedTo': { displayName: 'Ana' } },
    2: { 'System.State': 'New', 'System.AssignedTo': { displayName: 'Ana' } },
    3: { 'System.State': 'Done', 'System.AssignedTo': { displayName: 'Bia' } },
  };
  const querying = (extra: Record<string, unknown> = {}) => makeService({
    queryByWiql: async (...args: unknown[]) => {
      ((extra.queries as unknown[][]) ?? []).push(args);
      return { workItems: [{ id: 1 }, { id: 2 }, { id: 3 }], columns: [{ referenceName: 'System.Title' }] };
    },
    getWorkItems: async (ids: number[], fields: string[]) =>
      ids.map(id => ({ id, fields: Object.fromEntries(Object.entries(ITEMS[id]!).filter(([ref]) => fields.includes(ref))) })),
    getFields: async () => {
      (extra.fieldCalls as number[]).push(1);
      return [{ referenceName: 'Custom.Squad', name: 'Squad' }];
    },
  });

  it('builds the WIQL from the flags, resolving short names, without running it', async () => {
    const fieldCalls: number[] = [];
    const queries: unknown[][] = [];
    const { svc } = querying({ fieldCalls, queries });
    const result = await svc.queryWorkItems({ mine: true, where: "[squad] = 'Core' AND [priority] = 1", orderBy: 'closed desc', printWiql: true });
    expect(result).toEqual({
      wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @me AND ([Custom.Squad] = 'Core' AND [Microsoft.VSTS.Common.Priority] = 1) ORDER BY [Microsoft.VSTS.Common.ClosedDate] DESC",
    });
    expect(fieldCalls).toHaveLength(1);
    expect(queries).toEqual([]);
  });

  it('counts the matches, ignoring --top', async () => {
    const queries: unknown[][] = [];
    const { svc } = querying({ queries });
    expect(await svc.queryWorkItems({ states: ['Done'], top: 1, count: true })).toEqual({ count: 3 });
    expect(queries[0]![3]).toBeUndefined();
  });

  it('groups the matches by fields', async () => {
    const { svc } = querying();
    expect(await svc.queryWorkItems({ groupBy: ['state', 'assignedTo'] })).toEqual({
      total: 3,
      groups: [
        { State: 'Done', AssignedTo: 'Ana', count: 1 },
        { State: 'Done', AssignedTo: 'Bia', count: 1 },
        { State: 'New', AssignedTo: 'Ana', count: 1 },
      ],
    });
  });

  it('returns the asked columns in the asked order, empty where an item has no value', async () => {
    const { svc } = querying();
    expect(await svc.queryWorkItems({ fields: ['assignedTo', 'closed', 'state'], top: 2 })).toEqual([
      { id: 1, AssignedTo: 'Ana', ClosedDate: '', State: 'Done' },
      { id: 2, AssignedTo: 'Ana', ClosedDate: '', State: 'New' },
      { id: 3, AssignedTo: 'Bia', ClosedDate: '', State: 'Done' },
    ]);
  });

  it('names an unknown field with suggestions', async () => {
    const { svc } = querying({ fieldCalls: [] });
    await expect(svc.queryWorkItems({ fields: ['squa'] })).rejects.toThrow('Unknown field "squa". Did you mean: Custom.Squad (Squad)?');
  });
});

describe('WorkItemService.summarize', () => {
  it('confirms a write with the key fields and a browser link', () => {
    const { svc } = makeService();
    const summary = svc.summarize({
      id: 14696,
      fields: { 'System.Title': 'T', 'System.State': 'To Do', 'System.Description': 'long', 'System.AssignedTo': { displayName: 'Renato' } },
    });
    expect(summary).toEqual({ id: 14696, State: 'To Do', Title: 'T', AssignedTo: 'Renato', url: `${ORG}/Demo/_workitems/edit/14696` });
  });
});
