import { describe, expect, it } from 'bun:test';
import type { Comment } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import {
  assignedWiql,
  changeKind,
  changesByOthers,
  mentionedWiql,
  mentionsOf,
  mentionsUser,
  removalFromUser,
  removedWiql,
  resolveSince,
  watchedWiql,
} from '../src/services/inbox';

const ME = '30323507-6ddd-4290-988a-3bf0e6febd4c';
const OTHER = '11bb11bb-cc22-dd33-ee44-55ff55ff55ff';
const NOW = new Date(2026, 9, 6, 13, 0);

const html = (id: string) => `<div><a href="#" data-vss-mention="version:2.0,${id}">@Someone</a> olha isso</div>`;
const comment = (date: string, text: string, author = OTHER): Comment => ({
  createdDate: new Date(date),
  createdBy: { id: author },
  text,
});

describe('resolveSince', () => {
  it('starts from --since when given, over the stored last check', () => {
    expect(resolveSince('2026-10-01', '2026-10-05T10:00:00.000Z', NOW)).toEqual(new Date(2026, 9, 1));
  });

  it('starts from the stored last check, to the instant', () => {
    expect(resolveSince(undefined, '2026-10-05T10:00:00.123Z', NOW)).toEqual(new Date('2026-10-05T10:00:00.123Z'));
  });

  it('looks back one day on the first check or a stored value that is not a date', () => {
    const yesterday = new Date(2026, 9, 5);
    expect(resolveSince(undefined, undefined, NOW)).toEqual(yesterday);
    expect(resolveSince(undefined, 'garbage', NOW)).toEqual(yesterday);
  });

  it('rejects a --since it cannot read', () => {
    expect(() => resolveSince('ontem', undefined, NOW)).toThrow('Invalid date "ontem"');
  });
});

describe('inbox queries', () => {
  const since = new Date('2026-10-06T12:00:00.000Z');

  it('asks for my cards changed since the instant by anyone — the history decides who', () => {
    expect(assignedWiql(since)).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @me AND [System.ChangedDate] >= '2026-10-06T12:00:00.000Z' ORDER BY [System.ChangedDate] DESC",
    );
  });

  it('asks for the watched cards and their direct children changed since the instant, leaving mine to `assigned`', () => {
    expect(watchedWiql([14547, 14600], since)).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ([System.Id] IN (14547, 14600) OR [System.Parent] IN (14547, 14600)) AND [System.AssignedTo] <> @me AND [System.ChangedDate] >= '2026-10-06T12:00:00.000Z' ORDER BY [System.ChangedDate] DESC",
    );
  });

  it('asks for the cards that were mine, are not now and changed since the instant', () => {
    expect(removedWiql(since)).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] EVER @me AND [System.AssignedTo] <> @me AND [System.ChangedDate] >= '2026-10-06T12:00:00.000Z' ORDER BY [System.ChangedDate] DESC",
    );
  });

  it('asks for the cards that mention me and changed since the instant', () => {
    expect(mentionedWiql(since)).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Id] IN (@RecentMentions) AND [System.ChangedDate] >= '2026-10-06T12:00:00.000Z' ORDER BY [System.ChangedDate] DESC",
    );
  });
});

describe('mentionsUser', () => {
  it('finds the HTML mention of the user', () => {
    expect(mentionsUser(html(ME), ME)).toBe(true);
  });

  it('finds the Markdown mention, whatever the case of the id', () => {
    expect(mentionsUser(`@<${ME.toUpperCase()}> segue a análise`, ME)).toBe(true);
  });

  it('ignores a mention of someone else, the bare id and an empty comment', () => {
    expect(mentionsUser(html(OTHER), ME)).toBe(false);
    expect(mentionsUser(`id ${ME} sem menção`, ME)).toBe(false);
    expect(mentionsUser(undefined, ME)).toBe(false);
  });
});

describe('mentionsOf', () => {
  const since = new Date('2026-10-06T12:00:00.000Z');

  it('keeps the mentions made from the instant on', () => {
    const atStart = comment('2026-10-06T12:00:00.000Z', html(ME));
    const before = comment('2026-10-06T11:59:59.999Z', html(ME));
    expect(mentionsOf([atStart, before], ME, since)).toEqual([atStart]);
  });

  it('leaves out my own comments and comments that do not mention me', () => {
    const mine = comment('2026-10-06T13:00:00.000Z', html(ME), ME.toUpperCase());
    const unrelated = comment('2026-10-06T13:00:00.000Z', html(OTHER));
    expect(mentionsOf([mine, unrelated], ME, since)).toEqual([]);
  });
});

describe('changesByOthers', () => {
  const since = new Date('2026-10-06T12:00:00.000Z');
  const revision = (date: string, id: string, displayName: string) => ({
    fields: { 'System.ChangedDate': date, 'System.ChangedBy': { id, displayName } },
  });

  it('keeps a colleague’s change that a later change of mine would hide', () => {
    const revisions = [
      revision('2026-10-06T13:00:00.000Z', OTHER, 'Ana'),
      revision('2026-10-06T14:00:00.000Z', ME.toUpperCase(), 'Renato'),
    ];
    expect(changesByOthers(revisions, ME, since)).toEqual({ ChangedBy: 'Ana', ChangedDate: '2026-10-06T13:00:00.000Z' });
  });

  it('names everyone else once, latest first', () => {
    const revisions = [
      revision('2026-10-06T12:10:00.000Z', OTHER, 'Ana'),
      revision('2026-10-06T12:20:00.000Z', 'b1b1', 'Bia'),
      revision('2026-10-06T12:30:00.000Z', OTHER, 'Ana'),
    ];
    expect(changesByOthers(revisions, ME, since)).toEqual({ ChangedBy: 'Ana, Bia', ChangedDate: '2026-10-06T12:30:00.000Z' });
  });

  it('is nothing when only I changed the card in the window', () => {
    const revisions = [
      revision('2026-10-06T11:00:00.000Z', OTHER, 'Ana'),
      revision('2026-10-06T12:30:00.000Z', ME, 'Renato'),
    ];
    expect(changesByOthers(revisions, ME, since)).toBeUndefined();
  });
});

describe('removalFromUser', () => {
  const since = new Date('2026-10-06T12:00:00.000Z');
  const revision = (date: string, by: string, assignedTo?: string) => ({
    fields: {
      'System.ChangedDate': date,
      'System.ChangedBy': { id: by, displayName: by === ME ? 'Renato' : 'Ana' },
      ...(assignedTo ? { 'System.AssignedTo': { id: assignedTo, displayName: assignedTo === ME ? 'Renato' : 'Bia' } } : {}),
    },
  });

  it('finds the change in the window that took the card from me, comparing with the revision before it', () => {
    const revisions = [revision('2026-10-01T09:00:00.000Z', ME, ME), revision('2026-10-06T12:30:00.000Z', OTHER, 'b1b1')];
    expect(removalFromUser(revisions, ME, since)).toEqual({ RemovedBy: 'Ana', RemovedDate: '2026-10-06T12:30:00.000Z' });
  });

  it('counts a card left with no assignee', () => {
    const revisions = [revision('2026-10-01T09:00:00.000Z', ME, ME), revision('2026-10-06T12:30:00.000Z', OTHER)];
    expect(removalFromUser(revisions, ME, since)).toEqual({ RemovedBy: 'Ana', RemovedDate: '2026-10-06T12:30:00.000Z' });
  });

  it('reports the latest removal when the card left me more than once', () => {
    const revisions = [
      revision('2026-10-01T09:00:00.000Z', ME, ME),
      revision('2026-10-06T12:10:00.000Z', OTHER, 'b1b1'),
      revision('2026-10-06T12:20:00.000Z', OTHER, ME),
      revision('2026-10-06T12:40:00.000Z', OTHER, 'b1b1'),
    ];
    expect(removalFromUser(revisions, ME, since)?.RemovedDate).toBe('2026-10-06T12:40:00.000Z');
  });

  it('is nothing when I handed the card over, or it left me before the window', () => {
    const handedOver = [revision('2026-10-01T09:00:00.000Z', ME, ME), revision('2026-10-06T12:30:00.000Z', ME.toUpperCase(), 'b1b1')];
    const leftBefore = [
      revision('2026-10-01T09:00:00.000Z', ME, ME),
      revision('2026-10-05T09:00:00.000Z', OTHER, 'b1b1'),
      revision('2026-10-06T12:30:00.000Z', OTHER, 'b1b1'),
    ];
    expect(removalFromUser(handedOver, ME, since)).toBeUndefined();
    expect(removalFromUser(leftBefore, ME, since)).toBeUndefined();
  });
});

describe('changeKind', () => {
  const since = new Date('2026-10-06T12:00:00.000Z');

  it('calls a card created inside the window new, and an older one changed', () => {
    expect(changeKind('2026-10-06T12:30:00.000Z', since)).toBe('new');
    expect(changeKind('2026-09-01T10:00:00.000Z', since)).toBe('changed');
    expect(changeKind(undefined, since)).toBe('changed');
  });
});
