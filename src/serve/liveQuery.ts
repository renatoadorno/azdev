import type { ItemFilter, Meta } from '../interfaces/Serve';
import { buildWiql, queryConditions } from '../services/queryBuilder';
import { bucketCondition, categoriesFrom, type Bucket } from '../services/stats';
import { wiqlEscape } from '../services/workItemUtils';
import { parseChangedSince } from './filters';

/** The most ids a live query brings back; the rest is cut by the newest change. */
export const LIVE_LIMIT = 1000;

const OPEN: Bucket[] = ['todo', 'doing'];
const CLOSED: Bucket[] = ['done', 'removed'];

/** Values of one key are OR'ed, so each becomes its own condition and the group is joined. */
function anyOf(conditions: string[]): string | undefined {
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : `(${conditions.join(' OR ')})`;
}

function categoryCondition(categories: string[], meta: Meta): string {
  const wanted = categories.map(c => c.toLowerCase());
  const byType = meta.types.flatMap(type => {
    const states = type.states.filter(s => wanted.includes(s.category.toLowerCase())).map(s => `'${wiqlEscape(s.name)}'`);
    return states.length ? [`([System.WorkItemType] = '${wiqlEscape(type.name)}' AND [System.State] IN (${states.join(', ')}))`] : [];
  });
  return anyOf(byType) ?? '[System.Id] < 0';
}

/**
 * An item filter as WIQL conditions. The cache applies the same filter again to
 * what comes back, so these only need to be as wide as the filter — never narrower.
 */
export function filterConditions(filter: ItemFilter, meta: Meta, sprintPaths: string[] | null, now = new Date()): string[] {
  const conditions: Array<string | undefined> = [];

  if (!filter.assignee?.some(a => a.toLowerCase() === 'any')) {
    conditions.push(
      anyOf(
        (filter.assignee ?? []).map(a =>
          a.toLowerCase() === 'none' ? queryConditions({ unassigned: true })[0]! : queryConditions({ assignedTo: a })[0]!,
        ),
      ),
    );
  }
  conditions.push(anyOf((sprintPaths ?? []).map(path => queryConditions({ iterationPath: path })[0]!)));
  if (filter.state?.length) conditions.push(...queryConditions({ states: filter.state }));
  if (filter.category?.length) conditions.push(categoryCondition(filter.category, meta));
  if (filter.open !== undefined) {
    const categories = categoriesFrom(meta.types);
    const typeNames = new Map(meta.types.map(t => [t.name.toLowerCase(), t.name]));
    conditions.push(bucketCondition(categories, filter.open ? OPEN : CLOSED, typeNames));
  }
  if (filter.type?.length) conditions.push(...queryConditions({ types: filter.type }));
  conditions.push(anyOf((filter.tag ?? []).map(tag => queryConditions({ tags: [tag] })[0]!)));
  conditions.push(anyOf((filter.area ?? []).map(area => queryConditions({ areaPath: area })[0]!)));
  conditions.push(anyOf((filter.parent ?? []).map(id => queryConditions({ parentId: id })[0]!)));
  if (filter.q) conditions.push(textCondition(filter.q));
  if (filter.changedSince) conditions.push(...queryConditions({ changedSince: parseChangedSince(filter.changedSince, now) }));

  return conditions.filter((c): c is string => c !== undefined);
}

/** Title only, like the local match: a description hit would be dropped right after and spend the limit. */
function textCondition(q: string): string {
  const id = q.match(/^#?(\d+)$/)?.[1];
  const title = `[System.Title] CONTAINS '${wiqlEscape(q.replace(/^#/, ''))}'`;
  return id ? `([System.Id] = ${id} OR ${title})` : q.startsWith('#') ? '[System.Id] < 0' : title;
}

export function filterWiql(filter: ItemFilter, meta: Meta, sprintPaths: string[] | null, now = new Date()): string {
  return buildWiql(filterConditions(filter, meta, sprintPaths, now));
}

/** Free text and nothing else: it can match anything, so no scope is kept for it. */
export function isTextOnly(filter: ItemFilter): boolean {
  const keys = Object.keys(filter).filter(key => (filter as Record<string, unknown>)[key] !== undefined);
  return keys.length === 1 && keys[0] === 'q';
}

/** The same filter written in another key order or case is the same scope. */
export function filterKey(filter: ItemFilter): string {
  const canonical = Object.entries(filter)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, Array.isArray(value) ? value.map(v => (typeof v === 'string' ? v.toLowerCase() : v)).sort() : typeof value === 'string' ? value.toLowerCase() : value]);
  return JSON.stringify(canonical);
}
