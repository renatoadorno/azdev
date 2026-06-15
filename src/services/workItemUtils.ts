/**
 * Shared helpers to turn raw Azure DevOps work items into compact,
 * display-friendly shapes. Used by hydration (list/mine/search/children)
 * and by the slim `get` view.
 */

/** States considered "finished" — used by the --open filter. */
export const CLOSED_STATES = ['Done', 'Closed', 'Removed', 'Completed'];

/** Hierarchy link type for parent/child relations. */
export const HIERARCHY_FORWARD = 'System.LinkTypes.Hierarchy-Forward';

/** Rich-text/multiline fields that support an HTML vs Markdown format. */
export const MULTILINE_FIELDS = [
  'System.Description',
  'System.History',
  'Microsoft.VSTS.Common.AcceptanceCriteria',
  'Microsoft.VSTS.TCM.ReproSteps',
  'Microsoft.VSTS.TCM.SystemInfo',
];

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
