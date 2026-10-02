/**
 * Revision history as a timeline of field changes — what the raw revisions
 * (one full snapshot per revision) bury under repeated, unchanged fields.
 */

import { htmlToText } from './richText';
import { shortKey } from './workItemUtils';

/** Fields worth following by default: state, ownership, planning and dates. */
export const DEFAULT_HISTORY_FIELDS = [
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.Reason',
  'System.AssignedTo',
  'System.IterationPath',
  'System.Tags',
  'System.BoardColumn',
  'System.Parent',
  'Microsoft.VSTS.Common.ClosedDate',
  'Microsoft.VSTS.Common.ActivatedDate',
  'Microsoft.VSTS.Common.ResolvedDate',
  'Microsoft.VSTS.Scheduling.StartDate',
  'Microsoft.VSTS.Scheduling.FinishDate',
  'Microsoft.VSTS.Scheduling.TargetDate',
  'Microsoft.VSTS.Scheduling.CompletedWork',
  'Microsoft.VSTS.Scheduling.RemainingWork',
  'System.Description',
];

// Bookkeeping that changes on every revision; System.History is shown as the comment.
const NEVER_TRACKED = new Set([
  'System.Rev',
  'System.ChangedDate',
  'System.ChangedBy',
  'System.AuthorizedDate',
  'System.RevisedDate',
  'System.Watermark',
  'System.PersonId',
  'System.AuthorizedAs',
  'System.History',
  'System.CommentCount',
]);

const EMPTY = '∅';

export interface TimelineEvent {
  rev?: number;
  date?: string;
  by?: string;
  changes: string;
  comment?: string;
}

function plain(value: unknown, maxText: number): string {
  if (value === undefined || value === null || value === '') return EMPTY;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const identity = value as { displayName?: string; uniqueName?: string };
    return identity.displayName ?? identity.uniqueName ?? JSON.stringify(value);
  }
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/[<&]/.test(text)) text = htmlToText(text);
  text = text.replace(/\s+/g, ' ').trim();
  return maxText > 0 && text.length > maxText ? `${text.slice(0, maxText)}…` : text;
}

function tracked(ref: string, fields?: string[]): boolean {
  if (NEVER_TRACKED.has(ref)) return false;
  if (!fields) return true;
  const short = shortKey(ref).toLowerCase();
  return fields.some(f => f.toLowerCase() === ref.toLowerCase() || f.toLowerCase() === short);
}

/**
 * One event per revision that changed a tracked field or carries a comment.
 * `fields` takes short or full names; `undefined` tracks every field — so no
 * default here, or an explicit `undefined` would silently fall back to it.
 */
export function revisionTimeline(revisions: any[], fields: string[] | undefined, maxText = 240): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let previous: Record<string, unknown> = {};

  for (const revision of revisions) {
    const current: Record<string, unknown> = revision?.fields ?? {};
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(current)])].filter(k => tracked(k, fields)).sort();
    const changes = keys
      .filter(k => plain(previous[k], 0) !== plain(current[k], 0))
      .map(k => `${shortKey(k)}: ${plain(previous[k], maxText)} → ${plain(current[k], maxText)}`);
    const comment = current['System.History'] ? plain(current['System.History'], maxText) : undefined;

    if (changes.length || comment) {
      const date = current['System.ChangedDate'];
      events.push({
        rev: revision?.rev,
        date: date ? new Date(date as string).toISOString() : undefined,
        by: plain(current['System.ChangedBy'], 0),
        changes: changes.join(' | '),
        ...(comment ? { comment } : {}),
      });
    }
    previous = current;
  }
  return events;
}
