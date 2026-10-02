/**
 * Shared helpers to turn raw Azure DevOps work items into compact,
 * display-friendly shapes. Used by hydration (list/mine/search/children)
 * and by the slim `get` view.
 */

import type { JsonPatchOperation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type { RichTextFormat, WorkItemFilters } from '../interfaces/WorkItems';

/** A hydrated work item as `slimWorkItem` returns it: `id` plus short field names. */
export type WorkItemRow = Record<string, unknown> & { id?: number };

/** States considered "finished" — used by the --open filter. */
export const CLOSED_STATES = ['Done', 'Closed', 'Removed', 'Completed'];

/** A discarded card: it neither counts as delivered nor as present in a flow. */
export const REMOVED_STATE = 'Removed';

/** Assignee alias for the authenticated user. */
export const ME = '@me';

export function isClosedState(state: unknown): boolean {
  return typeof state === 'string' && CLOSED_STATES.includes(state);
}

/** WIQL string literals escape single quotes by doubling them. */
export function wiqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

/** Hierarchy link type for parent → child relations. */
export const HIERARCHY_FORWARD = 'System.LinkTypes.Hierarchy-Forward';
/** Hierarchy link type for child → parent relations. */
export const HIERARCHY_REVERSE = 'System.LinkTypes.Hierarchy-Reverse';

/** REST url of a work item, the form relations point at. */
export function workItemApiUrl(orgUrl: string, id: number): string {
  return `${orgUrl}/_apis/wit/workItems/${id}`;
}

/** Trailing numeric id of a work item REST url. */
export function idFromWorkItemUrl(url?: string): number | undefined {
  const match = url?.match(/\/workItems\/(\d+)(?:[?#].*)?$/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * WIQL conditions (without the leading AND) for the shared filter flags.
 * `scope` qualifies the field for WorkItemLinks queries (`[Target].[System.State]`).
 */
export function buildFilterClauses(filters: WorkItemFilters, scope?: string): string[] {
  const field = (name: string) => (scope ? `[${scope}].[${name}]` : `[${name}]`);
  const clauses: string[] = [];
  if (filters.mine) clauses.push(`${field('System.AssignedTo')} = @me`);
  else if (filters.assignedTo) clauses.push(`${field('System.AssignedTo')} = '${wiqlEscape(filters.assignedTo)}'`);
  if (filters.state) clauses.push(`${field('System.State')} = '${wiqlEscape(filters.state)}'`);
  if (filters.openOnly) {
    clauses.push(`${field('System.State')} NOT IN (${CLOSED_STATES.map(s => `'${s}'`).join(', ')})`);
  }
  if (filters.type) clauses.push(`${field('System.WorkItemType')} = '${wiqlEscape(filters.type)}'`);
  return clauses;
}

/** `"a; b, c"` → `"a; b; c"` — the System.Tags wire format. Tags cannot hold `;` or `,`. */
export function parseTags(value?: string | string[]): string | undefined {
  const raw = Array.isArray(value) ? value : value?.split(/[;,]/) ?? [];
  const tags = raw.map(t => t.trim()).filter(Boolean);
  return tags.length ? [...new Set(tags)].join('; ') : undefined;
}

/** Fields echoed back after a write — enough to confirm it without the full object. */
export const WRITE_SUMMARY_FIELDS = [
  'WorkItemType',
  'State',
  'Title',
  'AssignedTo',
  'Parent',
  'IterationPath',
  'Tags',
];

/** Rich-text/multiline fields that support an HTML vs Markdown format. */
export const MULTILINE_FIELDS = [
  'System.Description',
  'System.History',
  'Microsoft.VSTS.Common.AcceptanceCriteria',
  'Microsoft.VSTS.TCM.ReproSteps',
  'Microsoft.VSTS.TCM.SystemInfo',
];

/**
 * JSON-patch ops setting each defined field, plus the `multilineFieldsFormat`
 * marker for the rich-text ones when a format is given. Undefined values are
 * skipped, so an absent optional flag never blanks a field.
 */
export function fieldOperations(fields: Record<string, unknown>, format?: RichTextFormat): JsonPatchOperation[] {
  const set = Object.entries(fields).filter(([, value]) => value !== undefined);
  const ops: JsonPatchOperation[] = set.map(([ref, value]) => ({ op: Operation.Add, path: `/fields/${ref}`, value }));
  if (!format) return ops;

  const formatValue = format === 'markdown' ? 'Markdown' : 'Html';
  for (const [ref] of set) {
    if (MULTILINE_FIELDS.includes(ref)) {
      ops.push({ op: Operation.Add, path: `/multilineFieldsFormat/${ref}`, value: formatValue });
    }
  }
  return ops;
}

/** JSON-patch op that makes the item being written a child of `parentId`. */
export function parentRelationOperation(orgUrl: string, parentId: number): JsonPatchOperation {
  return {
    op: Operation.Add,
    path: '/relations/-',
    value: { rel: HIERARCHY_REVERSE, url: workItemApiUrl(orgUrl, parentId) },
  };
}

/** Fields fetched when hydrating IDs without an explicit column list. */
export const DEFAULT_HYDRATE_FIELDS = [
  'System.Id',
  'System.WorkItemType',
  'System.State',
  'System.Title',
  'System.AssignedTo',
  'System.Parent',
];

const PREFERRED_ORDER = [
  'Id',
  'WorkItemType',
  'State',
  'Title',
  'AssignedTo',
  'Parent',
  'IterationPath',
  'AreaPath',
];

/** `System.WorkItemType` → `WorkItemType` (drops the namespace prefix). */
export function shortKey(refName: string): string {
  const parts = refName.split('.');
  return parts[parts.length - 1] || refName;
}

/** Identity objects collapse to their display name; everything else passes through. */
export function simplifyValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.displayName === 'string') return obj.displayName;
  }
  return value;
}

/** Matches a field reference against a user filter (by short or full name, case-insensitive). */
function matchesFilter(refName: string, filter: string[]): boolean {
  const ref = refName.toLowerCase();
  const short = shortKey(refName).toLowerCase();
  return filter.some(f => {
    const target = f.trim().toLowerCase();
    return target === ref || target === short;
  });
}

/**
 * Flatten a work item to `{ id, <ShortField>: value, ... }`, dropping avatars,
 * _links and descriptors. `fieldsFilter` (short or full names) limits the columns.
 */
export function slimWorkItem(workItem: any, fieldsFilter?: string[]): Record<string, unknown> {
  const fields = (workItem?.fields ?? {}) as Record<string, unknown>;
  const simplified: Record<string, unknown> = {};

  for (const [ref, val] of Object.entries(fields)) {
    if (ref === 'System.Id') continue; // already emitted as `id`
    if (fieldsFilter && fieldsFilter.length > 0 && !matchesFilter(ref, fieldsFilter)) continue;
    simplified[shortKey(ref)] = simplifyValue(val);
  }

  const ordered: Record<string, unknown> = { id: workItem?.id };
  const keys = Object.keys(simplified).sort((a, b) => {
    const ia = PREFERRED_ORDER.indexOf(a);
    const ib = PREFERRED_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  for (const k of keys) ordered[k] = simplified[k];
  return ordered;
}
