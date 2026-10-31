import type { ItemFilter, Meta } from '../interfaces/Serve';
import type { RawItem } from '../interfaces/Sync';
import { bucketCondition, bucketOf, categoriesFrom, type StateCategories } from '../services/stats';
import { wiqlEscape } from '../services/workItemUtils';
import { CARD_FIELD_REFS, parentOf, toPerson } from './cards';
import { OPEN_BUCKETS } from './categories';
import { currentSprint } from './meta';

/** What the cache keeps synced: each rule is both a WIQL condition and a local test. */
export type ScopeRule = { kind: 'mine-open' } | { kind: 'sprint'; path: string } | { kind: 'watch'; ids: number[] };

export interface Scope {
  key: string;
  rule: ScopeRule;
}

export interface ScopeContext {
  meEmail: string;
  categories: StateCategories;
  typeNames: Map<string, string>;
}


export function scopeContext(meta: Meta): ScopeContext {
  return {
    meEmail: meta.me.email.toLowerCase(),
    categories: categoriesFrom(meta.types),
    typeNames: new Map(meta.types.map(t => [t.name.toLowerCase(), t.name])),
  };
}

/**
 * My open cards in any sprint, the current sprint for everyone, and the watched
 * cards with their children. The previous sprint is left out on purpose: it is
 * fetched on demand the first time someone asks for it.
 */
export function defaultScopes(meta: Meta, watched: number[], now = new Date()): Scope[] {
  const scopes: Scope[] = [{ key: 'mine-open', rule: { kind: 'mine-open' } }];
  const sprint = currentSprint(meta, now);
  if (sprint) scopes.push({ key: `sprint:${sprint.path}`, rule: { kind: 'sprint', path: sprint.path } });
  if (watched.length) scopes.push({ key: 'watch', rule: { kind: 'watch', ids: [...new Set(watched)] } });
  return scopes;
}

export function scopeCondition(rule: ScopeRule, context: ScopeContext): string {
  switch (rule.kind) {
    case 'mine-open':
      return `[System.AssignedTo] = @me AND ${bucketCondition(context.categories, OPEN_BUCKETS, context.typeNames)}`;
    case 'sprint':
      return `[System.IterationPath] = '${wiqlEscape(rule.path)}'`;
    case 'watch': {
      const ids = rule.ids.join(', ');
      return `([System.Id] IN (${ids}) OR [${CARD_FIELD_REFS.parent}] IN (${ids}))`;
    }
  }
}

function isOpen(item: RawItem, context: ScopeContext): boolean {
  return OPEN_BUCKETS.includes(bucketOf(context.categories, item.fields['System.WorkItemType'], item.fields['System.State']));
}

/** The same test as the rule's WIQL, run on a cached item — so an item that left a scope is noticed locally. */
export function matchesRule(item: RawItem, rule: ScopeRule, context: ScopeContext): boolean {
  switch (rule.kind) {
    case 'mine-open':
      return toPerson(item.fields['System.AssignedTo'])?.email?.toLowerCase() === context.meEmail && isOpen(item, context);
    case 'sprint':
      return String(item.fields['System.IterationPath'] ?? '').toLowerCase() === rule.path.toLowerCase();
    case 'watch': {
      const parent = parentOf(item);
      return rule.ids.includes(item.id) || (parent !== undefined && rule.ids.includes(parent));
    }
  }
}

/**
 * Members (items some scope matches) plus their parents and their children: a
 * card shows its parent's title and its children's progress, so both are kept.
 * A parent id may name an item not fetched yet.
 */
export function itemsToKeep(items: RawItem[], scopes: Scope[], context: ScopeContext, extraMembers: Iterable<number> = []): Set<number> {
  const members = new Set(items.filter(item => scopes.some(s => matchesRule(item, s.rule, context))).map(item => item.id));
  for (const id of extraMembers) members.add(id);
  const keep = new Set(members);
  for (const item of items) {
    const parent = parentOf(item);
    if (parent === undefined) continue;
    if (members.has(item.id)) keep.add(parent);
    if (members.has(parent)) keep.add(item.id);
  }
  return keep;
}

/**
 * Whether the cache already holds every item a filter could match, so it can be
 * answered without asking Azure DevOps. `sprintPaths` are the filter's sprints
 * resolved to paths; `memberIds` are the items some scope matches.
 */
export function isCovered(
  filter: ItemFilter,
  scopes: Scope[],
  context: { sprintPaths: string[] | null; memberIds: Set<number> },
): boolean {
  const onlyMe = filter.assignee?.length === 1 && filter.assignee[0]!.toLowerCase() === '@me';
  if (onlyMe && filter.open === true && scopes.some(s => s.rule.kind === 'mine-open')) return true;

  const tracked = new Set(scopes.flatMap(s => (s.rule.kind === 'sprint' ? [s.rule.path.toLowerCase()] : [])));
  if (context.sprintPaths?.length && context.sprintPaths.every(path => tracked.has(path.toLowerCase()))) return true;

  // Children of a member are kept with it.
  return Boolean(filter.parent?.length && filter.parent.every(id => context.memberIds.has(id)));
}
