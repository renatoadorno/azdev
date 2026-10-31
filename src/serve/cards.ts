import type { Card, Meta, Person, SprintRef, StateInfo } from '../interfaces/Serve';
import type { RawItem } from '../interfaces/Sync';
import { workItemWebUrl } from '../services/workItemUtils';
import { currentSprint, stateLookup } from './meta';

/** Where each card field comes from. */
export const CARD_FIELD_REFS = {
  type: 'System.WorkItemType',
  state: 'System.State',
  title: 'System.Title',
  assignedTo: 'System.AssignedTo',
  sprint: 'System.IterationPath',
  area: 'System.AreaPath',
  tags: 'System.Tags',
  parent: 'System.Parent',
  commentCount: 'System.CommentCount',
  boardColumn: 'System.BoardColumn',
  changedAt: 'System.ChangedDate',
  changedBy: 'System.ChangedBy',
  createdAt: 'System.CreatedDate',
  priority: 'Microsoft.VSTS.Common.Priority',
  effort: 'Microsoft.VSTS.Scheduling.Effort',
  storyPoints: 'Microsoft.VSTS.Scheduling.StoryPoints',
  remainingWork: 'Microsoft.VSTS.Scheduling.RemainingWork',
  stateChangedAt: 'Microsoft.VSTS.Common.StateChangeDate',
} as const;

/**
 * The fields to ask for: only those the project has, because asking for a field
 * the process lacks (Effort in a Scrum project) fails the whole batch.
 */
export function itemFields(projectFieldRefs: string[]): string[] {
  const known = new Set(projectFieldRefs.map(ref => ref.toLowerCase()));
  return Object.values(CARD_FIELD_REFS).filter(ref => known.has(ref.toLowerCase()));
}

const DONE_CATEGORY = 'Completed';
const REMOVED_CATEGORY = 'Removed';

export interface CardContext {
  orgUrl: string;
  project: string;
  stateOf(type: string, state: string): StateInfo | undefined;
  sprintOf(path: string): SprintRef | null;
  lookup(id: number): RawItem | undefined;
  childrenOf(id: number): RawItem[];
}

export function createCardContext(
  meta: Meta,
  items: { get(id: number): RawItem | undefined; childrenOf(id: number): RawItem[] },
  now = new Date(),
): CardContext {
  const currentPath = currentSprint(meta, now)?.path.toLowerCase();
  const sprints = new Map(meta.sprints.map(s => [s.path.toLowerCase(), s]));
  return {
    orgUrl: meta.orgUrl,
    project: meta.project,
    stateOf: stateLookup(meta),
    sprintOf(path) {
      // The project root is the backlog, not a sprint.
      if (!path.includes('\\')) return null;
      const key = path.toLowerCase();
      const sprint = sprints.get(key);
      return {
        name: sprint?.name ?? path.split('\\').pop()!,
        path,
        ...(sprint?.start ? { start: sprint.start } : {}),
        ...(sprint?.finish ? { finish: sprint.finish } : {}),
        current: key === currentPath,
      };
    },
    lookup: id => items.get(id),
    childrenOf: id => items.childrenOf(id),
  };
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function date(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

/** An identity as the cache keeps it (`{displayName, uniqueName}`), or the legacy "Name <account>" string. */
export function toPerson(value: unknown): Person | null {
  if (typeof value === 'object' && value !== null) {
    const identity = value as { displayName?: unknown; uniqueName?: unknown };
    if (typeof identity.displayName !== 'string') return null;
    return typeof identity.uniqueName === 'string'
      ? { name: identity.displayName, email: identity.uniqueName }
      : { name: identity.displayName };
  }
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  return match ? { name: match[1]!, email: match[2]! } : { name: raw };
}

export function parseTags(value: unknown): string[] {
  return (text(value) ?? '')
    .split(';')
    .map(tag => tag.trim())
    .filter(Boolean);
}

/** Drops undefined keys: an optional field the item lacks is absent, not null. */
function compact<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as T;
}

export function toCard(item: RawItem, context: CardContext): Card {
  const f = item.fields;
  const type = text(f[CARD_FIELD_REFS.type]) ?? '';
  const state = text(f[CARD_FIELD_REFS.state]) ?? '';
  const stateInfo = context.stateOf(type, state);
  const sprintPath = text(f[CARD_FIELD_REFS.sprint]);
  const parentId = number(f[CARD_FIELD_REFS.parent]);
  const parent = parentId === undefined ? undefined : context.lookup(parentId);

  // A removed child is neither work left nor work done.
  const children = context
    .childrenOf(item.id)
    .map(child => context.stateOf(text(child.fields[CARD_FIELD_REFS.type]) ?? '', text(child.fields[CARD_FIELD_REFS.state]) ?? '')?.category)
    .filter(category => category !== REMOVED_CATEGORY);

  return compact({
    id: item.id,
    rev: item.rev,
    type,
    state,
    stateCategory: stateInfo?.category ?? 'Proposed',
    stateColor: stateInfo?.color,
    title: text(f[CARD_FIELD_REFS.title]) ?? '',
    assignedTo: toPerson(f[CARD_FIELD_REFS.assignedTo]),
    sprint: sprintPath ? context.sprintOf(sprintPath) : null,
    area: text(f[CARD_FIELD_REFS.area]) ?? '',
    tags: parseTags(f[CARD_FIELD_REFS.tags]),
    priority: number(f[CARD_FIELD_REFS.priority]),
    effort: number(f[CARD_FIELD_REFS.effort]),
    storyPoints: number(f[CARD_FIELD_REFS.storyPoints]),
    remainingWork: number(f[CARD_FIELD_REFS.remainingWork]),
    boardColumn: text(f[CARD_FIELD_REFS.boardColumn]),
    parent:
      parentId === undefined
        ? null
        : {
            id: parentId,
            title: text(parent?.fields[CARD_FIELD_REFS.title]) ?? '',
            type: text(parent?.fields[CARD_FIELD_REFS.type]) ?? '',
          },
    children: { total: children.length, done: children.filter(category => category === DONE_CATEGORY).length },
    commentCount: number(f[CARD_FIELD_REFS.commentCount]) ?? 0,
    changedBy: toPerson(f[CARD_FIELD_REFS.changedBy]) ?? undefined,
    changedAt: date(f[CARD_FIELD_REFS.changedAt]) ?? '',
    stateChangedAt: date(f[CARD_FIELD_REFS.stateChangedAt]),
    createdAt: date(f[CARD_FIELD_REFS.createdAt]) ?? '',
    url: workItemWebUrl(context.orgUrl, context.project, item.id),
  });
}
