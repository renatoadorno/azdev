import type { RawItem, RawMeta, SyncSource } from '../src/interfaces/Sync';

/** Shared fixtures for the `azdev serve` cache tests: a small project and a fake Azure DevOps. */

export const ORG = 'https://dev.azure.com/acme';
export const PROJECT = 'Demo';
export const NOW = new Date('2026-10-31T12:00:00Z');
export const ME = { id: 'me-guid', name: 'Renato', email: 'renato@acme.com' };
export const ANA = { displayName: 'Ana', uniqueName: 'ana@acme.com' };
export const MINE = { displayName: ME.name, uniqueName: ME.email };

export const RAW_META: RawMeta = {
  me: ME,
  types: [
    {
      name: 'Task',
      color: 'F2CB1D',
      states: [
        { name: 'To Do', category: 'Proposed', color: 'b2b2b2' },
        { name: 'In Progress', category: 'InProgress', color: '007acc' },
        { name: 'homologing', category: 'InProgress', color: 'fbe74b' },
        { name: 'Done', category: 'Completed', color: '339933' },
        { name: 'Removed', category: 'Removed', color: 'ffffff' },
      ],
      // As the real process: Removed cannot go to In Progress or Done.
      transitions: {
        '': [{ to: 'To Do' }],
        'To Do': [{ to: 'In Progress' }, { to: 'homologing' }, { to: 'Done' }, { to: 'Removed' }],
        'In Progress': [{ to: 'To Do' }, { to: 'homologing' }, { to: 'Done' }, { to: 'Removed' }],
        homologing: [{ to: 'To Do' }, { to: 'In Progress' }, { to: 'Done' }, { to: 'Removed' }],
        Done: [{ to: 'To Do' }, { to: 'In Progress' }, { to: 'homologing' }],
        Removed: [{ to: 'To Do' }, { to: 'homologing' }],
      },
    },
    {
      name: 'Product Backlog Item',
      states: [
        { name: 'New', category: 'Proposed' },
        { name: 'Committed', category: 'InProgress' },
        { name: 'Done', category: 'Completed' },
        { name: 'Removed', category: 'Removed' },
      ],
      transitions: {},
    },
    { name: 'Old Type', isDisabled: true, states: [{ name: 'Open', category: 'Proposed' }] },
  ],
  teamSprints: [
    { id: 's81', name: 'Sprint 81', path: 'Demo\\Sprint 81', startDate: '2026-10-06T00:00:00Z', finishDate: '2026-10-19T00:00:00Z', timeframe: 'past' },
    { id: 's82', name: 'Sprint 82', path: 'Demo\\Sprint 82', startDate: '2026-10-20T00:00:00Z', finishDate: '2026-11-02T00:00:00Z', timeframe: 'current' },
    { id: 's83', name: 'Sprint 83', path: 'Demo\\Sprint 83', startDate: '2026-11-03T00:00:00Z', finishDate: '2026-11-16T00:00:00Z', timeframe: 'future' },
  ],
  projectSprints: [
    { name: 'Demo', path: 'Demo' },
    { id: 's80', name: 'Sprint 80', path: 'Demo\\Sprint 80', startDate: '2026-09-22T00:00:00Z', finishDate: '2026-10-05T00:00:00Z' },
    { id: 's81', name: 'Sprint 81', path: 'Demo\\Sprint 81' },
    { id: 's82', name: 'Sprint 82', path: 'Demo\\Sprint 82' },
  ],
  members: [
    { name: 'Zé', email: 'ze@acme.com' },
    { name: 'Ana', email: 'ana@acme.com' },
  ],
  tags: ['backend', 'api'],
  areas: ['Demo', 'Demo\\Backend'],
  fieldRefs: [
    'System.Id',
    'System.WorkItemType',
    'System.State',
    'System.Title',
    'System.AssignedTo',
    'System.IterationPath',
    'System.AreaPath',
    'System.Tags',
    'System.Parent',
    'System.CommentCount',
    'System.ChangedDate',
    'System.ChangedBy',
    'System.CreatedDate',
    'Microsoft.VSTS.Common.Priority',
    'Microsoft.VSTS.Scheduling.RemainingWork',
  ],
};

/** What a failed connection to Azure DevOps looks like: a socket error code, which the daemon reads as offline. */
export function offlineError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 13.107.42.20:443'), { code: 'ECONNREFUSED' });
}

export interface ItemSpec {
  rev?: number;
  type?: string;
  state?: string;
  title?: string;
  assignee?: { displayName: string; uniqueName: string } | null;
  sprint?: string;
  area?: string;
  parent?: number;
  tags?: string;
  changedAt?: string;
  priority?: number;
  comments?: number;
}

export function item(id: number, spec: ItemSpec = {}): RawItem {
  const fields: Record<string, unknown> = {
    'System.WorkItemType': spec.type ?? 'Task',
    'System.State': spec.state ?? 'To Do',
    'System.Title': spec.title ?? `Card ${id}`,
    'System.IterationPath': spec.sprint ?? 'Demo\\Sprint 82',
    'System.AreaPath': spec.area ?? 'Demo\\Backend',
    'System.ChangedDate': spec.changedAt ?? '2026-10-30T10:00:00.000Z',
    'System.CreatedDate': '2026-10-20T10:00:00.000Z',
    'System.ChangedBy': ANA,
    'System.CommentCount': spec.comments ?? 0,
  };
  if (spec.assignee !== null) fields['System.AssignedTo'] = spec.assignee ?? MINE;
  if (spec.parent !== undefined) fields['System.Parent'] = spec.parent;
  if (spec.tags !== undefined) fields['System.Tags'] = spec.tags;
  if (spec.priority !== undefined) fields['Microsoft.VSTS.Common.Priority'] = spec.priority;
  return { id, rev: spec.rev ?? 1, fields };
}

const OPEN = (state: unknown) => state !== 'Done' && state !== 'Removed';

/**
 * Azure DevOps in memory. It answers the WIQL the cache sends by its shape —
 * mine-open, a sprint, watch, children — which is all the engine relies on.
 */
export class FakeSource implements SyncSource {
  items = new Map<number, RawItem>();
  meta: RawMeta = RAW_META;
  queries: string[] = [];
  precise: boolean[] = [];
  fetches: Array<{ ids: number[]; fields: string[] }> = [];
  metaCalls = 0;
  identityCalls = 0;
  failWith: Error | null = null;

  constructor(items: RawItem[] = []) {
    this.set(...items);
  }

  async fetchIdentity(): Promise<RawMeta['me']> {
    if (this.failWith) throw this.failWith;
    this.identityCalls++;
    return this.meta.me;
  }

  set(...items: RawItem[]): void {
    for (const it of items) this.items.set(it.id, it);
  }

  delete(id: number): void {
    this.items.delete(id);
  }

  async fetchMeta(): Promise<RawMeta> {
    if (this.failWith) throw this.failWith;
    this.metaCalls++;
    return this.meta;
  }

  async runQuery(wiql: string, timePrecision?: boolean): Promise<number[]> {
    if (this.failWith) throw this.failWith;
    this.queries.push(wiql);
    this.precise.push(timePrecision === true);
    const all = [...this.items.values()];
    const ids = (text: string) => text.split(',').map(s => Number(s.trim()));
    const parentIn = (list: number[]) => all.filter(it => list.includes(it.fields['System.Parent'] as number)).map(it => it.id);

    const changed = wiql.match(/\[System\.ChangedDate\] > '([^']*)'/);
    if (changed) {
      return all.filter(it => String(it.fields['System.ChangedDate']) > changed[1]!).map(it => it.id);
    }
    const title = wiql.match(/\[System\.Title\] CONTAINS '((?:[^']|'')*)'/);
    if (title) {
      const text = title[1]!.replace(/''/g, "'").toLowerCase();
      return all.filter(it => String(it.fields['System.Title']).toLowerCase().includes(text)).map(it => it.id);
    }

    if (wiql.includes('[System.AssignedTo] = @me')) {
      const email = this.meta.me.email;
      return all
        .filter(it => (it.fields['System.AssignedTo'] as { uniqueName?: string } | undefined)?.uniqueName === email && OPEN(it.fields['System.State']))
        .map(it => it.id);
    }
    const sprint = wiql.match(/\[System\.IterationPath\] = '((?:[^']|'')*)'/);
    if (sprint) {
      return all
        .filter(it => it.fields['System.IterationPath'] === sprint[1]!.replace(/''/g, "'"))
        .sort((a, b) => String(b.fields['System.ChangedDate']).localeCompare(String(a.fields['System.ChangedDate'])))
        .map(it => it.id);
    }
    const watch = wiql.match(/\[System\.Id\] IN \(([^)]*)\) OR \[System\.Parent\] IN/);
    if (watch) {
      const watched = ids(watch[1]!);
      return [...new Set([...watched.filter(id => this.items.has(id)), ...parentIn(watched)])];
    }
    const parents = wiql.match(/\[System\.Parent\] IN \(([^)]*)\)/);
    if (parents) return parentIn(ids(parents[1]!));
    return [];
  }

  detailCalls: Array<{ id: number; comments: number }> = [];
  revisionCalls: number[] = [];
  writes: Array<{ id: number; state: string; rev?: number; comment?: string }> = [];
  /** What `viewWorkItem` answers for any card. */
  view: Record<string, unknown> = {
    description: 'Descrição',
    children: [{ id: 1, WorkItemType: 'Task', State: 'To Do', Title: 'Filha' }],
    links: [{ link: 'Related', id: 9, WorkItemType: 'Bug', State: 'New', Title: 'Parente' }],
    images: ['https://dev.azure.com/acme/_apis/wit/attachments/abc?fileName=a.png'],
    attachments: [{ name: 'a.pdf', url: 'https://dev.azure.com/acme/_apis/wit/attachments/def' }],
    comments: { total: 1, shown: 1, items: [{ id: 5, author: 'Ana', date: '2026-10-30T10:00:00.000Z', text: 'Oi' }] },
  };
  revisions: unknown[] = [];

  async fetchDetail(id: number, comments: number): Promise<Record<string, unknown>> {
    if (this.failWith) throw this.failWith;
    this.detailCalls.push({ id, comments });
    return this.view;
  }

  async fetchRevisions(id: number): Promise<unknown[]> {
    if (this.failWith) throw this.failWith;
    this.revisionCalls.push(id);
    return this.revisions;
  }

  /** Applies the state like the API: a `test /rev` that no longer holds refuses the whole write. */
  async changeState(change: { id: number; state: string; rev?: number; comment?: string }, fields: string[]): Promise<RawItem> {
    if (this.failWith) throw this.failWith;
    this.writes.push(change);
    const current = this.items.get(change.id);
    if (!current) throw Object.assign(new Error(`Work item ${change.id} not found`), { statusCode: 404 });
    if (change.rev !== undefined && change.rev !== current.rev) {
      throw Object.assign(new Error('TF26071: This work item has been changed by someone else since you opened it.'), { statusCode: 412 });
    }
    const saved: RawItem = { id: change.id, rev: current.rev + 1, fields: { ...current.fields, 'System.State': change.state } };
    this.items.set(saved.id, saved);
    return { ...saved, fields: Object.fromEntries(Object.entries(saved.fields).filter(([ref]) => fields.includes(ref))) };
  }

  async fetchItems(ids: number[], fields: string[]): Promise<RawItem[]> {
    if (this.failWith) throw this.failWith;
    this.fetches.push({ ids, fields });
    return ids.flatMap(id => (this.items.has(id) ? [this.items.get(id)!] : []));
  }
}
