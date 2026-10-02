/**
 * Field names as an agent writes them (`assignedTo`, `closed`, `Remaining Work`)
 * resolved to the reference names WIQL and the API take (`System.AssignedTo`).
 */

/** Short names for the common fields — the same in every process. */
export const FIELD_ALIASES: Record<string, string> = {
  id: 'System.Id',
  title: 'System.Title',
  state: 'System.State',
  reason: 'System.Reason',
  type: 'System.WorkItemType',
  workitemtype: 'System.WorkItemType',
  assignedto: 'System.AssignedTo',
  assignee: 'System.AssignedTo',
  createdby: 'System.CreatedBy',
  changedby: 'System.ChangedBy',
  tags: 'System.Tags',
  parent: 'System.Parent',
  area: 'System.AreaPath',
  areapath: 'System.AreaPath',
  sprint: 'System.IterationPath',
  iteration: 'System.IterationPath',
  iterationpath: 'System.IterationPath',
  project: 'System.TeamProject',
  description: 'System.Description',
  history: 'System.History',
  boardcolumn: 'System.BoardColumn',
  boardlane: 'System.BoardLane',
  commentcount: 'System.CommentCount',
  created: 'System.CreatedDate',
  createddate: 'System.CreatedDate',
  changed: 'System.ChangedDate',
  changeddate: 'System.ChangedDate',
  activated: 'Microsoft.VSTS.Common.ActivatedDate',
  activateddate: 'Microsoft.VSTS.Common.ActivatedDate',
  resolved: 'Microsoft.VSTS.Common.ResolvedDate',
  resolveddate: 'Microsoft.VSTS.Common.ResolvedDate',
  closed: 'Microsoft.VSTS.Common.ClosedDate',
  closeddate: 'Microsoft.VSTS.Common.ClosedDate',
  statechange: 'Microsoft.VSTS.Common.StateChangeDate',
  statechangedate: 'Microsoft.VSTS.Common.StateChangeDate',
  priority: 'Microsoft.VSTS.Common.Priority',
  severity: 'Microsoft.VSTS.Common.Severity',
  acceptancecriteria: 'Microsoft.VSTS.Common.AcceptanceCriteria',
  effort: 'Microsoft.VSTS.Scheduling.Effort',
  storypoints: 'Microsoft.VSTS.Scheduling.StoryPoints',
  remaining: 'Microsoft.VSTS.Scheduling.RemainingWork',
  remainingwork: 'Microsoft.VSTS.Scheduling.RemainingWork',
  originalestimate: 'Microsoft.VSTS.Scheduling.OriginalEstimate',
  completedwork: 'Microsoft.VSTS.Scheduling.CompletedWork',
};

/** A field as the project's field list (`getFields`) describes it. */
export interface FieldDefinition {
  referenceName?: string;
  name?: string;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '');
}

function shortName(referenceName: string): string {
  return referenceName.split('.').pop() ?? referenceName;
}

/** Resolves without the project's field list: aliases, and reference names taken as given. */
export function resolveFieldOffline(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  return FIELD_ALIASES[normalize(trimmed)] ?? (trimmed.includes('.') ? trimmed : undefined);
}

/**
 * Reference name of `name` among the project's fields: reference name, alias,
 * display name (`Remaining Work`) or the last segment of a reference name
 * (`Custom.Squad` → `squad`). Throws when several fields fit.
 */
export function resolveField(name: string, known: FieldDefinition[]): string | undefined {
  const target = normalize(name.trim());
  if (!target) return undefined;
  const refs = known.map(f => f.referenceName).filter((r): r is string => !!r);
  const byRef = refs.find(r => r.toLowerCase() === name.trim().toLowerCase());
  if (byRef) return byRef;

  const alias = FIELD_ALIASES[target];
  if (alias && refs.includes(alias)) return alias;

  const candidates = [...new Set(known
    .filter(f => f.referenceName && (normalize(f.name ?? '') === target || normalize(shortName(f.referenceName)) === target))
    .map(f => f.referenceName!))];
  if (candidates.length > 1) throw new Error(`Field "${name}" is ambiguous: ${candidates.join(', ')} — pass the reference name`);
  return candidates[0];
}

/** Up to five fields whose name or reference name contains `name`. */
export function suggestFields(name: string, known: FieldDefinition[]): string[] {
  const target = normalize(name);
  return known
    .filter(f => f.referenceName && (normalize(f.name ?? '').includes(target) || normalize(f.referenceName).includes(target)))
    .slice(0, 5)
    .map(f => `${f.referenceName} (${f.name})`);
}
