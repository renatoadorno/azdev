import { describe, expect, it } from 'bun:test';
import { CommentFormat } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { Comment } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { InboxService } from '../src/services/InboxService';

const ORG = 'https://dev.azure.com/acme';
const ME = '30323507-6ddd-4290-988a-3bf0e6febd4c';
const ANA = '11bb11bb-cc22-dd33-ee44-55ff55ff55ff';
const BIA = '22cc22cc-dd33-ee44-ff55-66aa66aa66aa';
const SINCE = new Date('2026-10-06T12:00:00.000Z');

const NAMES: Record<string, string> = { [ME]: 'Renato', [ANA]: 'Ana', [BIA]: 'Bia' };
const person = (id: string) => ({ id, displayName: NAMES[id] });
const revision = (date: string, by: string, assignedTo?: string) => ({
  fields: {
    'System.ChangedDate': date,
    'System.ChangedBy': person(by),
    ...(assignedTo ? { 'System.AssignedTo': person(assignedTo) } : {}),
  },
});
/** `count` revisions an hour apart, the last at `last`, all by `by`. */
const hourly = (count: number, last: string, by: string, assignedTo?: string) =>
  Array.from({ length: count }, (_, i) => revision(new Date(new Date(last).getTime() - (count - 1 - i) * 3_600_000).toISOString(), by, assignedTo));

/** Revisions per card, oldest first — revision n is at index n - 1. */
const REVISIONS: Record<number, ReturnType<typeof revision>[]> = {
  10: [revision('2026-10-06T12:40:00.000Z', ANA)],
  11: [revision('2026-09-01T09:00:00.000Z', ME), revision('2026-10-06T12:10:00.000Z', BIA), revision('2026-10-06T12:30:00.000Z', ME)],
  12: [revision('2026-09-01T09:00:00.000Z', ANA), revision('2026-10-06T12:30:00.000Z', ME)],
  13: [...hourly(10, '2026-10-06T11:00:00.000Z', ME), ...hourly(50, '2026-10-08T15:00:00.000Z', ANA)],
  14: [...hourly(117, '2026-10-06T11:00:00.000Z', ME), ...hourly(3, '2026-10-06T15:00:00.000Z', BIA)],
  // Ana takes the card from me inside the window, Bia works on it after.
  30: [revision('2026-10-01T09:00:00.000Z', ANA, ME), revision('2026-10-06T12:20:00.000Z', ANA, BIA), revision('2026-10-06T12:50:00.000Z', BIA, BIA)],
  // I hand the card over myself.
  31: [revision('2026-10-01T09:00:00.000Z', ANA, ME), revision('2026-10-06T12:20:00.000Z', ME, BIA)],
  // It left me before the window; only Bia's work is inside it.
  32: [revision('2026-10-01T09:00:00.000Z', ANA, ME), revision('2026-10-05T09:00:00.000Z', ANA, BIA), revision('2026-10-06T12:20:00.000Z', BIA, BIA)],
  // The revision before Ana's removal sits on the previous page of a long history.
  33: [...hourly(10, '2026-10-06T11:00:00.000Z', ME, ME), revision('2026-10-06T12:05:00.000Z', ANA), ...hourly(49, '2026-10-08T15:00:00.000Z', BIA)],
};

const ITEMS: Record<number, Record<string, unknown>> = {
  10: { 'System.WorkItemType': 'Task', 'System.State': 'New', 'System.Title': 'Criada pela Ana', 'System.CreatedDate': '2026-10-06T12:40:00.000Z' },
  11: { 'System.WorkItemType': 'Bug', 'System.State': 'Done', 'System.Title': 'Bia e depois eu', 'System.CreatedDate': '2026-09-01T09:00:00.000Z' },
  12: { 'System.WorkItemType': 'Task', 'System.State': 'Doing', 'System.Title': 'Só eu', 'System.CreatedDate': '2026-09-01T09:00:00.000Z' },
  13: { 'System.WorkItemType': 'Task', 'System.State': 'Doing', 'System.Title': 'Longa na janela', 'System.CreatedDate': '2026-09-01T09:00:00.000Z' },
  14: { 'System.WorkItemType': 'Task', 'System.State': 'Doing', 'System.Title': 'Longa fora da janela', 'System.CreatedDate': '2026-09-01T09:00:00.000Z' },
  30: { 'System.WorkItemType': 'Task', 'System.State': 'Doing', 'System.Title': 'Ana tirou de mim', 'System.AssignedTo': person(BIA) },
  31: { 'System.WorkItemType': 'Task', 'System.State': 'Doing', 'System.Title': 'Eu passei adiante', 'System.AssignedTo': person(BIA) },
  32: { 'System.WorkItemType': 'Task', 'System.State': 'Doing', 'System.Title': 'Saiu antes da janela', 'System.AssignedTo': person(BIA) },
  33: { 'System.WorkItemType': 'Bug', 'System.State': 'New', 'System.Title': 'Ficou sem responsável', 'System.CreatedDate': '2026-09-01T09:00:00.000Z' },
  20: { 'System.Title': 'Review A' },
  21: { 'System.Title': 'Review B' },
};
for (const [id, revisions] of Object.entries(REVISIONS)) ITEMS[Number(id)]!['System.Rev'] = revisions.length;

const mention = (id: string, words: string) => `<div><a href="#" data-vss-mention="version:2.0,${id}">@Renato</a> ${words}</div>`;
const comment = (date: string, text: string, author = ANA): Comment => ({ createdDate: new Date(date), createdBy: { id: author, displayName: NAMES[author] }, text });

/** Newest-first comment pages per card; a page's token names the next one. */
type Pages = Record<number, Array<{ comments: Comment[]; continuationToken?: string }>>;

function makeService({ assigned = [] as number[], removed = [] as number[], pages = {} as Pages } = {}) {
  const wiql: unknown[][] = [];
  const revisionCalls: Array<[number, number, number]> = [];
  const commentCalls: Array<[number, string | undefined]> = [];
  const witApi = {
    queryByWiql: async (...args: unknown[]) => {
      wiql.push(args);
      const query = (args[0] as { query: string }).query;
      const ids = query.includes('@RecentMentions') ? [20, 21] : query.includes('EVER @me') ? removed : assigned;
      return { workItems: ids.map(id => ({ id })) };
    },
    getWorkItems: async (ids: number[], fields: string[]) =>
      ids.map(id => ({ id, fields: Object.fromEntries(Object.entries(ITEMS[id]!).filter(([ref]) => fields.includes(ref))) })),
    getRevisions: async (id: number, top: number, skip: number) => {
      revisionCalls.push([id, top, skip]);
      return REVISIONS[id]!.slice(skip, skip + top);
    },
    getComments: async (_project: string, id: number, _top: number, token?: string) => {
      commentCalls.push([id, token]);
      const cardPages = pages[id] ?? [];
      return cardPages[token ? Number(token) : 0] ?? { comments: [] };
    },
  };

  const svc = new InboxService({ orgUrl: ORG, project: 'Demo', personalAccessToken: 'tok', auth: { type: 'pat' } });
  (svc as any).connection = {
    getWorkItemTrackingApi: async () => witApi,
    connect: async () => ({ authenticatedUser: { id: ME, properties: { Account: { $value: 'me@acme.dev' } } } }),
  };
  return { svc, wiql, revisionCalls, commentCalls };
}

describe('InboxService.inbox — cards assigned to me', () => {
  it('reads each card’s history: a colleague’s change survives a later one of mine', async () => {
    const { svc, wiql } = makeService({ assigned: [11, 10, 12] });
    const { since, assigned } = await svc.inbox({ since: SINCE });

    expect(since).toBe('2026-10-06T12:00:00.000Z');
    expect(wiql.map(call => call[2])).toEqual([true, true, true]);
    expect(assigned).toEqual([
      { id: 10, WorkItemType: 'Task', State: 'New', Title: 'Criada pela Ana', ChangedBy: 'Ana', ChangedDate: '2026-10-06T12:40:00.000Z', change: 'new', url: `${ORG}/Demo/_workitems/edit/10` },
      { id: 11, WorkItemType: 'Bug', State: 'Done', Title: 'Bia e depois eu', ChangedBy: 'Bia', ChangedDate: '2026-10-06T12:10:00.000Z', change: 'changed', url: `${ORG}/Demo/_workitems/edit/11` },
    ]);
  });

  it('walks a long history back page by page, only as far as the window', async () => {
    const { svc, revisionCalls } = makeService({ assigned: [13, 14] });
    const { assigned } = await svc.inbox({ since: SINCE });

    expect(revisionCalls.filter(([id]) => id === 13)).toEqual([[13, 50, 10], [13, 10, 0]]);
    expect(revisionCalls.filter(([id]) => id === 14)).toEqual([[14, 50, 70]]);
    expect(assigned.map(row => [row.id, row.ChangedBy, row.ChangedDate])).toEqual([
      [13, 'Ana', '2026-10-08T15:00:00.000Z'],
      [14, 'Bia', '2026-10-06T15:00:00.000Z'],
    ]);
  });
});

describe('InboxService.inbox — cards taken from me', () => {
  it('lists the cards someone else took from me in the window, with where they are now', async () => {
    const { svc } = makeService({ removed: [31, 30, 32, 33] });
    const { removed } = await svc.inbox({ since: SINCE });

    expect(removed).toEqual([
      { id: 30, WorkItemType: 'Task', State: 'Doing', Title: 'Ana tirou de mim', AssignedTo: 'Bia', RemovedBy: 'Ana', RemovedDate: '2026-10-06T12:20:00.000Z', url: `${ORG}/Demo/_workitems/edit/30` },
      { id: 33, WorkItemType: 'Bug', State: 'New', Title: 'Ficou sem responsável', AssignedTo: '', RemovedBy: 'Ana', RemovedDate: '2026-10-06T12:05:00.000Z', url: `${ORG}/Demo/_workitems/edit/33` },
    ]);
  });
});

describe('InboxService.inbox — mentions', () => {
  it('lists the comments that mention me since the instant, newest first, as plain text', async () => {
    const { svc } = makeService({
      pages: {
        20: [{
          comments: [
            comment('2026-10-06T12:30:00.000Z', mention(ME, 'revisa o PR')),
            comment('2026-10-06T12:20:00.000Z', mention(ME, 'nota para mim'), ME),
            comment('2026-10-06T12:15:00.000Z', mention(ANA, 'outra pessoa')),
            comment('2026-10-06T11:00:00.000Z', mention(ME, 'antes da janela')),
          ],
        }],
        21: [{ comments: [{ ...comment('2026-10-06T12:50:00.000Z', `@<${ME.toUpperCase()}> segue a análise`), format: CommentFormat.Markdown }] }],
      },
    });
    const { mentions } = await svc.inbox({ since: SINCE });

    expect(mentions).toEqual([
      { id: 21, Title: 'Review B', author: 'Ana', date: '2026-10-06T12:50:00.000Z', text: `@<${ME.toUpperCase()}> segue a análise`, url: `${ORG}/Demo/_workitems/edit/21` },
      { id: 20, Title: 'Review A', author: 'Ana', date: '2026-10-06T12:30:00.000Z', text: '@Renato revisa o PR', url: `${ORG}/Demo/_workitems/edit/20` },
    ]);
  });

  it('pages the comments of a card only until one predates the window', async () => {
    const { svc, commentCalls } = makeService({
      pages: {
        20: [
          { comments: [comment('2026-10-06T12:30:00.000Z', mention(ME, 'novo'))], continuationToken: '1' },
          { comments: [comment('2026-10-06T12:05:00.000Z', mention(ME, 'segunda página')), comment('2026-10-06T11:00:00.000Z', 'velho')], continuationToken: '2' },
          { comments: [comment('2026-10-05T10:00:00.000Z', mention(ME, 'nunca lido'))] },
        ],
      },
    });
    const { mentions } = await svc.inbox({ since: SINCE });

    expect(commentCalls.filter(([id]) => id === 20)).toEqual([[20, undefined], [20, '1']]);
    expect(mentions.map(m => m.text)).toEqual(['@Renato novo', '@Renato segunda página']);
  });
});
