/**
 * Pure WIQL building for `workitem query`: filter flags → conditions, relative
 * dates (`7d`, `2w`), short field names inside a free `--where` and `--orderBy`.
 */

import { CLOSED_STATES, ME, wiqlEscape } from './workItemUtils';

const DAY_MS = 86_400_000;

/** Local calendar day of a date, `YYYY-MM-DD` — the form WIQL compares dates by. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Start of the local day `date` falls on. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * `7d`, `2w`, `3m`, `1y`, `today`, `yesterday` or `YYYY-MM-DD` → the day it names
 * (start of that local day). Throws on anything else.
 */
export function parseSince(value: string, now = new Date()): Date {
  const text = value.trim().toLowerCase();
  const today = startOfDay(now);
  if (text === 'today') return today;
  if (text === 'yesterday') return new Date(today.getTime() - DAY_MS);

  const relative = text.match(/^(\d+)\s*([dwmy])$/);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2];
    if (unit === 'd' || unit === 'w') {
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() - (unit === 'w' ? 7 * n : n));
    }
    // Months back keep the day when the target month has it: 1m from 31 Mar is 28/29 Feb, not 3 Mar.
    const months = unit === 'm' ? n : 12 * n;
    const target = new Date(today.getFullYear(), today.getMonth() - months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return new Date(target.getFullYear(), target.getMonth(), Math.min(today.getDate(), lastDay));
  }

  const absolute = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (absolute) {
    const date = new Date(Number(absolute[1]), Number(absolute[2]) - 1, Number(absolute[3]));
    if (isoDay(date) === text) return date;
  }
  throw new Error(`Invalid date "${value}": use 7d, 2w, 3m, 1y, today, yesterday or YYYY-MM-DD`);
}

/** `[f] = 'a'` for one value, `[f] IN ('a', 'b')` for several. */
export function inClause(field: string, values: string[]): string {
  const quoted = values.map(v => `'${wiqlEscape(v)}'`);
  return quoted.length === 1 ? `[${field}] = ${quoted[0]}` : `[${field}] IN (${quoted.join(', ')})`;
}

/**
 * Resolves `[shortName]` inside a WIQL fragment (`[assignedTo] = @me`), leaving
 * reference names and literals in single or double quotes (`'[PROD]'`) alone.
 */
export function rewriteFieldRefs(fragment: string, resolve: (name: string) => string): string {
  return fragment.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|\[([^[\]]+)\]/g, (match, name: string | undefined) => {
    if (name === undefined || name.includes('.')) return match;
    return `[${resolve(name)}]`;
  });
}

/** `changed desc, id` → `[System.ChangedDate] DESC, [System.Id]`. */
export function buildOrderBy(value: string, resolve: (name: string) => string): string {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [name, direction, ...rest] = part.split(/\s+/);
      const dir = direction?.toUpperCase();
      if (rest.length || (dir && dir !== 'ASC' && dir !== 'DESC')) {
        throw new Error(`Invalid --orderBy "${part}": use "<field> [asc|desc]"`);
      }
      const field = name!.startsWith('[') ? name! : `[${resolve(name!)}]`;
      return dir ? `${field} ${dir}` : field;
    })
    .join(', ');
}

/** Filters of a query, with sprint and dates already resolved. */
export interface QueryFilters {
  mine?: boolean;
  assignedTo?: string;
  unassigned?: boolean;
  types?: string[];
  excludeTypes?: string[];
  states?: string[];
  openOnly?: boolean;
  iterationPath?: string;
  areaPath?: string;
  tags?: string[];
  text?: string;
  parentId?: number;
  createdSince?: Date;
  changedSince?: Date;
  closedSince?: Date;
  /** Free WIQL condition, field names already resolved. */
  where?: string;
}

/** WIQL conditions (without the leading AND) for the filters. */
export function queryConditions(f: QueryFilters): string[] {
  const conditions: string[] = [];
  // `@me` is a WIQL macro only unquoted.
  if (f.mine || f.assignedTo?.trim().toLowerCase() === ME) conditions.push('[System.AssignedTo] = @me');
  else if (f.assignedTo) conditions.push(`[System.AssignedTo] = '${wiqlEscape(f.assignedTo)}'`);
  if (f.unassigned) conditions.push(`[System.AssignedTo] = ''`);
  if (f.types?.length) conditions.push(inClause('System.WorkItemType', f.types));
  if (f.excludeTypes?.length) {
    conditions.push(`[System.WorkItemType] NOT IN (${f.excludeTypes.map(t => `'${wiqlEscape(t)}'`).join(', ')})`);
  }
  if (f.states?.length) conditions.push(inClause('System.State', f.states));
  if (f.openOnly) conditions.push(`[System.State] NOT IN (${CLOSED_STATES.map(s => `'${s}'`).join(', ')})`);
  if (f.iterationPath) conditions.push(`[System.IterationPath] = '${wiqlEscape(f.iterationPath)}'`);
  if (f.areaPath) conditions.push(`[System.AreaPath] UNDER '${wiqlEscape(f.areaPath)}'`);
  for (const tag of f.tags ?? []) conditions.push(`[System.Tags] CONTAINS '${wiqlEscape(tag)}'`);
  if (f.text) {
    const text = wiqlEscape(f.text);
    conditions.push(`([System.Title] CONTAINS '${text}' OR [System.Description] CONTAINS '${text}')`);
  }
  if (f.parentId) conditions.push(`[System.Parent] = ${f.parentId}`);
  if (f.createdSince) conditions.push(`[System.CreatedDate] >= '${isoDay(f.createdSince)}'`);
  if (f.changedSince) conditions.push(`[System.ChangedDate] >= '${isoDay(f.changedSince)}'`);
  if (f.closedSince) conditions.push(`[Microsoft.VSTS.Common.ClosedDate] >= '${isoDay(f.closedSince)}'`);
  if (f.where?.trim()) conditions.push(`(${f.where.trim()})`);
  return conditions;
}

export const DEFAULT_ORDER_BY = '[System.ChangedDate] DESC';

export function buildWiql(conditions: string[], orderBy = DEFAULT_ORDER_BY): string {
  const where = ['[System.TeamProject] = @project', ...conditions].join(' AND ');
  return `SELECT [System.Id] FROM WorkItems WHERE ${where} ORDER BY ${orderBy}`;
}

/** Rows grouped by the values of `keys`, largest group first. */
export function groupCounts(rows: Record<string, unknown>[], keys: string[]): Record<string, unknown>[] {
  const groups = new Map<string, { values: Record<string, unknown>; count: number }>();
  for (const row of rows) {
    const values = Object.fromEntries(keys.map(k => [k, row[k] ?? '']));
    const id = JSON.stringify(keys.map(k => values[k]));
    const group = groups.get(id);
    if (group) group.count++;
    else groups.set(id, { values, count: 1 });
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || JSON.stringify(Object.values(a.values)).localeCompare(JSON.stringify(Object.values(b.values))))
    .map(g => ({ ...g.values, count: g.count }));
}
