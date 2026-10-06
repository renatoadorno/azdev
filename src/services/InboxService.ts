import { CommentSortOrder } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { Comment, WorkItem } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import type { InboxParams } from '../interfaces/WorkItems';
import { WorkItemService } from './WorkItemService';
import type { Bucket } from './stats';
import type { WatchEntry } from './watch';
import {
  assignedWiql,
  changeKind,
  changesByOthers,
  mentionedWiql,
  mentionsOf,
  removalFromUser,
  removedWiql,
  watchedWiql,
} from './inbox';

/** The page the comment API serves at most. */
const COMMENTS_PAGE = 200;

/** Revisions read per call, walking back from the latest: a window rarely holds more. */
const REVISIONS_PAGE = 50;

const ASSIGNED_FIELDS = [
  'System.WorkItemType',
  'System.State',
  'System.Title',
  'System.Rev',
  'System.CreatedDate',
];

const REMOVED_FIELDS = [
  'System.WorkItemType',
  'System.State',
  'System.Title',
  'System.AssignedTo',
  'System.Rev',
];

const WATCHED_FIELDS = [...ASSIGNED_FIELDS, 'System.AssignedTo', 'System.Parent'];

const CLOSED_FIELDS = ['System.WorkItemType', 'System.State', 'System.Title'];

const WATCH_LIST_FIELDS = [...CLOSED_FIELDS, 'System.AssignedTo'];

export interface InboxMention {
  id: number;
  Title?: string;
  author?: string;
  date?: string;
  text?: string;
  url: string;
}

export interface Inbox {
  since: string;
  assigned: Record<string, unknown>[];
  removed: Record<string, unknown>[];
  watched: Record<string, unknown>[];
  /** Watched cards finished along with all their children — a check moves them to the archive. */
  closed: Record<string, unknown>[];
  mentions: InboxMention[];
}

type ChangedRow = Record<string, any> & { id: number; ChangedBy: string; ChangedDate: string };

export class InboxService extends WorkItemService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  /** Fails on a card that does not exist or cannot be read, before it is watched. */
  public async requireCard(id: number): Promise<void> {
    const [card] = await this.hydrate([id], ['System.Title']);
    if (!card) throw new Error(`Work item ${id} not found in project "${this.config.project}"`);
  }

  /** Watched (or archived) cards as they are now, in the order they were added. */
  public async watchRows(entries: Array<WatchEntry & { archivedAt?: string }>): Promise<Record<string, unknown>[]> {
    const cards = await this.hydrate(entries.map(entry => entry.id), WATCH_LIST_FIELDS);
    const byId = new Map(cards.map(card => [card.id, card]));
    return entries.map(({ id, ...dates }) => {
      const card = byId.get(id) ?? {};
      return {
        id,
        WorkItemType: card.WorkItemType ?? '',
        State: card.State ?? '',
        Title: card.Title ?? '',
        AssignedTo: card.AssignedTo ?? '',
        ...dates,
        url: this.webUrl(id),
      };
    });
  }

  /**
   * Since `since`: cards assigned to me that someone else created or changed, cards someone
   * else took from me, watched cards and their children that someone else changed, the
   * watched cards that closed, and comments that mention me.
   */
  public async inbox(params: InboxParams): Promise<Inbox> {
    const userId = await this.currentUserId();
    const watchedIds = params.watched ?? [];
    const [assigned, removed, watched, closed, mentions] = await Promise.all([
      this.assignedSince(params.since, userId),
      this.removedSince(params.since, userId),
      this.watchedSince(params.since, userId, watchedIds),
      this.closedOf(watchedIds),
      this.mentionsSince(params.since, userId),
    ]);
    // A card taken from me under a watched story is already in `removed`.
    const removedIds = new Set(removed.map(row => row.id));
    return {
      since: params.since.toISOString(),
      assigned,
      removed,
      watched: watched.filter(row => !removedIds.has(row.id)),
      closed,
      mentions,
    };
  }

  private async assignedSince(since: Date, userId: string): Promise<ChangedRow[]> {
    const ids = await this.queryIds(assignedWiql(since), undefined, true);
    return this.changedByOthers(ids, ASSIGNED_FIELDS, since, userId);
  }

  private async watchedSince(since: Date, userId: string, watched: number[]): Promise<ChangedRow[]> {
    if (watched.length === 0) return [];
    const ids = await this.queryIds(watchedWiql(watched, since), undefined, true);
    const rows = await this.changedByOthers(ids, WATCHED_FIELDS, since, userId);
    return rows.map(({ id, Parent, WorkItemType, State, Title, AssignedTo, ...change }) => ({
      id,
      Watched: watched.includes(id) ? id : Parent,
      WorkItemType,
      State,
      Title,
      AssignedTo: AssignedTo ?? '',
      ...change,
    }) as ChangedRow);
  }

  /** The cards among `ids` that someone else changed since `since`, read off their history; latest first. */
  private async changedByOthers(ids: number[], fields: string[], since: Date, userId: string): Promise<ChangedRow[]> {
    const cards = await this.hydrate(ids, fields);
    const rows = await Promise.all(cards.map(async ({ Rev, CreatedDate, ...card }) => {
      const others = changesByOthers(await this.revisionsSince(card.id, Rev, since), userId, since);
      return others && { ...card, ...others, change: changeKind(CreatedDate, since), url: this.webUrl(card.id) };
    }));
    return rows
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
      .sort((a, b) => b.ChangedDate.localeCompare(a.ChangedDate));
  }

  /**
   * Watched cards that are finished: done or removed — by state category, so a custom state
   * like `published` counts — and so is every direct child. A story looks done before its
   * review, tests and publication cards close, and that is the part worth watching.
   */
  private async closedOf(ids: number[]): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];
    const closedBuckets: Bucket[] = ['done', 'removed'];
    const [cards, bucket] = await Promise.all([this.hydrate(ids, CLOSED_FIELDS), this.bucketFn()]);
    const isClosed = (row: Record<string, unknown>) => closedBuckets.includes(bucket(row));
    const closed = cards.filter(isClosed);
    const children = await this.childrenOf(closed.map(card => card.id), CLOSED_FIELDS);
    return closed
      .filter(card => (children.get(card.id) ?? []).every(isClosed))
      .map(card => ({ ...card, url: this.webUrl(card.id) }));
  }

  private async removedSince(since: Date, userId: string): Promise<Record<string, unknown>[]> {
    const ids = await this.queryIds(removedWiql(since), undefined, true);
    const cards = await this.hydrate(ids, REMOVED_FIELDS);
    const rows = await Promise.all(cards.map(async ({ Rev, ...card }) => {
      const removal = removalFromUser(await this.revisionsSince(card.id, Rev, since), userId, since);
      return removal && { ...card, AssignedTo: card.AssignedTo ?? '', ...removal, url: this.webUrl(card.id) };
    }));
    return rows
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
      .sort((a, b) => b.RemovedDate.localeCompare(a.RemovedDate));
  }

  /**
   * Revisions of a card from the latest back, page by page, until one predates `since` —
   * an old card is not read whole. Revision numbers run 1..Rev, so `skip` addresses them.
   */
  private async revisionsSince(id: number, rev: number, since: Date): Promise<WorkItem[]> {
    const witApi = await this.getWorkItemTrackingApi();
    const pages: WorkItem[][] = [];
    for (let end = rev; end > 0;) {
      const skip = Math.max(0, end - REVISIONS_PAGE);
      const page = (await witApi.getRevisions(id, end - skip, skip, undefined, this.config.project)) ?? [];
      pages.unshift(page);
      const oldest = page[0]?.fields?.['System.ChangedDate'];
      if (!oldest || new Date(oldest) < since) break;
      end = skip;
    }
    return pages.flat();
  }

  private async mentionsSince(since: Date, userId: string): Promise<InboxMention[]> {
    const ids = await this.queryIds(mentionedWiql(since), undefined, true);
    const cards = await this.hydrate(ids, ['System.Title']);
    const perCard = await Promise.all(cards.map(async card => {
      const comments = mentionsOf(await this.commentsSince(card.id, since), userId, since);
      return comments.map(comment => {
        const { author, date, text } = this.slimComment(comment);
        return { id: card.id, Title: card.Title, author, date, text, url: this.webUrl(card.id) };
      });
    }));
    return perCard.flat().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }

  /** Comments of a card, newest first, paging only until one predates `since`. */
  private async commentsSince(id: number, since: Date): Promise<Comment[]> {
    const witApi = await this.getWorkItemTrackingApi();
    const found: Comment[] = [];
    let token: string | undefined;
    do {
      const page = await witApi.getComments(this.config.project, id, COMMENTS_PAGE, token, false, undefined, CommentSortOrder.Desc);
      const comments = page?.comments ?? [];
      found.push(...comments);
      const reachedOlder = comments.some(c => c.createdDate && new Date(c.createdDate) < since);
      token = reachedOlder ? undefined : page?.continuationToken;
    } while (token);
    return found;
  }
}
