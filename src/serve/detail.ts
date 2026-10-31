import type { Card, CardDetail, CommentInfo, LinkedItem } from '../interfaces/Serve';

/** The most entries kept: a detail is read again and again while a card is open. */
export const DETAIL_CACHE_SIZE = 200;
export const DEFAULT_COMMENTS = 20;
export const MAX_COMMENTS = 200;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

function linkedItem(row: unknown): LinkedItem | null {
  if (!isRecord(row) || !Number.isSafeInteger(row.id)) return null;
  return {
    id: row.id as number,
    ...(text(row.link) ? { link: text(row.link) } : {}),
    ...(text(row.Title) ? { title: text(row.Title) } : {}),
    ...(text(row.WorkItemType) ? { type: text(row.WorkItemType) } : {}),
    ...(text(row.State) ? { state: text(row.State) } : {}),
  };
}

function linkedItems(rows: unknown): LinkedItem[] {
  return (Array.isArray(rows) ? rows : []).flatMap(row => linkedItem(row) ?? []);
}

function comment(row: unknown): CommentInfo | null {
  if (!isRecord(row) || !Number.isSafeInteger(row.id)) return null;
  return {
    id: row.id as number,
    ...(text(row.author) ? { author: text(row.author) } : {}),
    ...(text(row.date) ? { date: text(row.date) } : {}),
    text: text(row.text) ?? '',
  };
}

/** What `WorkItemViewService.viewWorkItem` returns, in the shape of the protocol. */
export function toCardDetail(card: Card, view: Record<string, unknown>, history?: unknown[]): CardDetail {
  const comments = isRecord(view.comments) ? view.comments : {};
  const attachments = (Array.isArray(view.attachments) ? view.attachments : []).flatMap(entry =>
    isRecord(entry) && text(entry.url) ? [{ name: text(entry.name) ?? '', url: text(entry.url)! }] : [],
  );
  return {
    card,
    ...(text(view.description) ? { description: text(view.description) } : {}),
    ...(text(view.acceptanceCriteria) ? { acceptanceCriteria: text(view.acceptanceCriteria) } : {}),
    comments: {
      total: Number.isSafeInteger(comments.total) ? (comments.total as number) : 0,
      items: (Array.isArray(comments.items) ? comments.items : []).flatMap(row => comment(row) ?? []),
    },
    children: linkedItems(view.children),
    links: linkedItems(view.links),
    images: Array.isArray(view.images) ? view.images.filter((url): url is string => typeof url === 'string') : [],
    attachments,
    ...(history ? { history } : {}),
  };
}

/** Least recently used goes first when it is full. */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly capacity = DETAIL_CACHE_SIZE) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }

  clear(): void {
    this.entries.clear();
  }
}

/** A card that changed (another rev) or got a comment is another entry; so is another way of asking. */
export function detailKey(card: Pick<Card, 'id' | 'rev' | 'commentCount'>, comments: number, history: boolean): string {
  return `${card.id}:${card.rev}:${card.commentCount}:${comments}:${history ? 'h' : ''}`;
}
