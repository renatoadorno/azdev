import { CommentSortOrder } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { Comment, WorkItem } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import type { InboxParams } from '../interfaces/WorkItems';
import { WorkItemService } from './WorkItemService';
import {
  assignedWiql,
  changeKind,
  changesByOthers,
  mentionedWiql,
  mentionsOf,
  removalFromUser,
  removedWiql,
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
  mentions: InboxMention[];
}

export class InboxService extends WorkItemService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  /** The project read — the last check is kept per project. */
  public get project(): string {
    return this.config.project;
  }

  /**
   * Since `since`: cards assigned to me that someone else created or changed, cards someone
   * else took from me, and comments that mention me.
   */
  public async inbox(params: InboxParams): Promise<Inbox> {
    const userId = await this.currentUserId();
    const [assigned, removed, mentions] = await Promise.all([
      this.assignedSince(params.since, userId),
      this.removedSince(params.since, userId),
      this.mentionsSince(params.since, userId),
    ]);
    return { since: params.since.toISOString(), assigned, removed, mentions };
  }

  private async assignedSince(since: Date, userId: string): Promise<Record<string, unknown>[]> {
    const ids = await this.queryIds(assignedWiql(since), undefined, true);
    const cards = await this.hydrate(ids, ASSIGNED_FIELDS);
    const rows = await Promise.all(cards.map(async ({ Rev, CreatedDate, ...card }) => {
      const others = changesByOthers(await this.revisionsSince(card.id, Rev, since), userId, since);
      return others && { ...card, ...others, change: changeKind(CreatedDate, since), url: this.webUrl(card.id) };
    }));
    return rows
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
      .sort((a, b) => b.ChangedDate.localeCompare(a.ChangedDate));
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
