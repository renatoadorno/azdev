/**
 * Pure rules of `workitem inbox`: the window since the last check, the queries
 * that find what reached the user in it, and which comments mention them.
 */

import type { Comment } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { buildWiql, parseSince } from './queryBuilder';

/** How far the very first check looks back. */
export const FIRST_CHECK_WINDOW = '1d';

/** Start of the window: `--since` wins, then the stored last check, then the first-check window. */
export function resolveSince(flag: string | undefined, lastCheck: string | undefined, now = new Date()): Date {
  if (flag) return parseSince(flag, now);
  const stored = lastCheck ? new Date(lastCheck) : undefined;
  if (stored && !Number.isNaN(stored.getTime())) return stored;
  return parseSince(FIRST_CHECK_WINDOW, now);
}

// Without `timePrecision` WIQL compares dates by day; the inbox needs the exact instant.
const changedSince = (since: Date) => `[System.ChangedDate] >= '${since.toISOString()}'`;

/**
 * Cards assigned to me that changed since `since`, by anyone: a change of mine after a
 * colleague's would hide theirs from `[System.ChangedBy]`, so their history decides.
 */
export function assignedWiql(since: Date): string {
  return buildWiql(['[System.AssignedTo] = @me', changedSince(since)]);
}

/**
 * Cards that were mine at some point, are not now (`<>` also matches no assignee) and
 * changed since `since` — whether they left me inside the window is the history's call.
 */
export function removedWiql(since: Date): string {
  return buildWiql(['[System.AssignedTo] EVER @me', '[System.AssignedTo] <> @me', changedSince(since)]);
}

interface Revision {
  fields?: Record<string, unknown>;
}

type Identity = { id?: string; displayName?: string; uniqueName?: string } | undefined;

const identityId = (value: unknown) => (value as Identity)?.id?.toLowerCase();
const identityName = (value: unknown) => (value as Identity)?.displayName ?? (value as Identity)?.uniqueName ?? 'unknown';

export interface ChangesByOthers {
  /** Everyone else who changed the card in the window, latest first. */
  ChangedBy: string;
  /** When the latest of them did. */
  ChangedDate: string;
}

/** Changes in the window made by someone other than the user; nothing when only the user changed the card. */
export function changesByOthers(revisions: Revision[], userId: string, since: Date): ChangesByOthers | undefined {
  const others = revisions
    .map(r => ({ by: r.fields?.['System.ChangedBy'], date: new Date(r.fields?.['System.ChangedDate'] as string) }))
    .filter(r => r.date >= since && identityId(r.by) !== userId.toLowerCase())
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  if (others.length === 0) return undefined;
  return {
    ChangedBy: [...new Set(others.map(r => identityName(r.by)))].join(', '),
    ChangedDate: others[0]!.date.toISOString(),
  };
}

export interface RemovalFromUser {
  RemovedBy: string;
  RemovedDate: string;
}

/**
 * The latest change in the window that took the card from the user, made by someone else;
 * nothing when the user handed it over. `revisions` run oldest first and reach one revision
 * before the window, so the first change inside it has a "before" to compare with.
 */
export function removalFromUser(revisions: Revision[], userId: string, since: Date): RemovalFromUser | undefined {
  const me = userId.toLowerCase();
  for (let i = revisions.length - 1; i > 0; i--) {
    const before = revisions[i - 1]!.fields ?? {};
    const after = revisions[i]!.fields ?? {};
    const date = new Date(after['System.ChangedDate'] as string);
    if (!(date >= since)) break;
    const tookFromMe = identityId(before['System.AssignedTo']) === me && identityId(after['System.AssignedTo']) !== me;
    if (tookFromMe && identityId(after['System.ChangedBy']) !== me) {
      return { RemovedBy: identityName(after['System.ChangedBy']), RemovedDate: date.toISOString() };
    }
  }
  return undefined;
}

/** Cards that mention me and changed since `since`; adding a comment changes the card. */
export function mentionedWiql(since: Date): string {
  return buildWiql(['[System.Id] IN (@RecentMentions)', changedSince(since)]);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** HTML stores a mention as `data-vss-mention="version:2.0,<id>"`; Markdown as `@<id>`. */
export function mentionsUser(text: string | undefined, userId: string): boolean {
  if (!text) return false;
  const id = escapeRegExp(userId);
  return new RegExp(`data-vss-mention="version:[\\d.]+,${id}"|@<${id}>`, 'i').test(text);
}

/** Comments created since `since` that mention the user, leaving out the user's own. */
export function mentionsOf(comments: Comment[], userId: string, since: Date): Comment[] {
  return comments.filter(c =>
    c.createdDate !== undefined
    && new Date(c.createdDate) >= since
    && c.createdBy?.id?.toLowerCase() !== userId.toLowerCase()
    && mentionsUser(c.text, userId));
}

export type InboxChange = 'new' | 'changed';

/** A card created inside the window is new to the user; anything older was changed. */
export function changeKind(createdDate: unknown, since: Date): InboxChange {
  return createdDate && new Date(createdDate as string) >= since ? 'new' : 'changed';
}
