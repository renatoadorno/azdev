import { describe, expect, it } from 'bun:test';
import {
  ageOf,
  boardHabits,
  breakdown,
  bucketCondition,
  bucketOf,
  carriedIn,
  categoriesFrom,
  distribution,
  effortSummary,
  endOfDayOrNow,
  isBacklogSprint,
  isoWeek,
  itemDurations,
  iterationDay,
  pace,
  percentile,
  sprintTimeline,
  summarizeDays,
  totals,
  weeklyThroughput,
  workingDays,
} from '../src/services/stats';
import { isoDay } from '../src/services/queryBuilder';

const TYPES = [
  { name: 'Task', states: [{ name: 'To Do', category: 'Proposed' }, { name: 'staging', category: 'InProgress' }, { name: 'Done', category: 'Completed' }, { name: 'Removed', category: 'Removed' }] },
  { name: 'Publication', states: [{ name: 'New', category: 'Proposed' }, { name: 'Approved', category: 'InProgress' }, { name: 'Done', category: 'Completed' }] },
  { name: 'Issue', states: [{ name: 'New', category: 'Proposed' }, { name: 'Committed', category: 'InProgress' }, { name: 'Done', category: 'Completed' }] },
];
const CATEGORIES = categoriesFrom(TYPES);
const bucket = (row: Record<string, unknown>) => bucketOf(CATEGORIES, row.WorkItemType, row.State);

describe('state buckets', () => {
  it('reads custom states through their category', () => {
    expect(bucketOf(CATEGORIES, 'Task', 'staging')).toBe('doing');
    expect(bucketOf(CATEGORIES, 'publication', 'approved')).toBe('doing');
    expect(bucketOf(CATEGORIES, 'Task', 'Done')).toBe('done');
    expect(bucketOf(CATEGORIES, 'Task', 'Removed')).toBe('removed');
  });

  it('falls back on the state name for a type the process does not describe', () => {
    expect(bucketOf(CATEGORIES, 'Unknown', 'Closed')).toBe('done');
    expect(bucketOf(CATEGORIES, 'Unknown', 'Removed')).toBe('removed');
    expect(bucketOf(CATEGORIES, 'Unknown', 'Waiting')).toBe('todo');
  });

  it('builds one WIQL condition per distinct state list', () => {
    const names = new Map(TYPES.map(t => [t.name.toLowerCase(), t.name]));
    expect(bucketCondition(CATEGORIES, ['done'], names)).toBe(
      "([System.WorkItemType] IN ('Task', 'Publication', 'Issue') AND [System.State] IN ('done'))",
    );
    expect(bucketCondition(CATEGORIES, ['todo', 'doing'], names)).toBe(
      "(([System.WorkItemType] IN ('Task') AND [System.State] IN ('staging', 'to do')) OR ([System.WorkItemType] IN ('Publication') AND [System.State] IN ('approved', 'new')) OR ([System.WorkItemType] IN ('Issue') AND [System.State] IN ('committed', 'new')))",
    );
    expect(bucketCondition(new Map(), ['done'], names)).toBe('[System.Id] < 0');
  });
});

describe('totals and breakdown', () => {
  const rows = [
    { id: 1, WorkItemType: 'Task', State: 'Done', AssignedTo: 'Ana' },
    { id: 2, WorkItemType: 'Task', State: 'staging', AssignedTo: 'Ana' },
    { id: 3, WorkItemType: 'Issue', State: 'New', AssignedTo: 'Bia' },
    { id: 4, WorkItemType: 'Task', State: 'Removed', AssignedTo: 'Bia' },
  ];

  it('counts each bucket and leaves removed items out of the total', () => {
    expect(totals(rows, bucket)).toEqual({ items: 3, todo: 1, doing: 1, done: 1, donePct: 33.3, removed: 1 });
  });

  it('breaks the totals down by a field, biggest group first', () => {
    expect(breakdown(rows, 'AssignedTo', bucket, 'assignedTo')).toEqual([
      { assignedTo: 'Ana', items: 2, todo: 0, doing: 1, done: 1, donePct: 50 },
      { assignedTo: 'Bia', items: 1, todo: 1, doing: 0, done: 0, donePct: 0 },
    ]);
  });

  it('sums effort only for the estimates the items carry', () => {
    expect(effortSummary(rows, bucket)).toBeUndefined();
    expect(effortSummary([{ ...rows[1]!, RemainingWork: 6 }, { ...rows[0]!, RemainingWork: 4 }], bucket)).toEqual({ remainingWork: 6 });
    expect(effortSummary([{ ...rows[0]!, Effort: 3 }, { ...rows[2]!, Effort: 5 }], bucket)).toEqual({ planned: 8, delivered: 3, deliveredPct: 37.5 });
  });
});

describe('sprint time', () => {
  // Azure DevOps stores iteration dates as UTC midnights: 21/09 (Mon) to 04/10 (Sun).
  const START = '2026-09-21T00:00:00Z';
  const FINISH = '2026-10-04T00:00:00Z';

  it('reads an iteration date as its calendar day, whatever the time zone', () => {
    expect(isoDay(iterationDay(START))).toBe('2026-09-21');
  });

  it('counts working days only', () => {
    expect(workingDays(iterationDay(START), iterationDay(FINISH)).map(isoDay)).toHaveLength(10);
  });

  it('places today in the sprint, today itself still under way', () => {
    expect(sprintTimeline(START, FINISH, new Date(2026, 9, 2, 15))).toEqual({
      workingDays: 10, daysElapsed: 9, daysLeft: 1, timeElapsedPct: 90, state: 'running',
    });
    expect(sprintTimeline(START, FINISH, new Date(2026, 8, 20)).state).toBe('not started');
    expect(sprintTimeline(START, FINISH, new Date(2026, 9, 5)).state).toBe('finished');
    // Saturday after the last working day: every working day is over, but the sprint runs until Sunday.
    expect(sprintTimeline(START, FINISH, new Date(2026, 9, 3))).toMatchObject({ daysLeft: 0, state: 'running' });
  });

  it('places a sprint with no working day by its dates', () => {
    const weekend = ['2026-10-03T00:00:00Z', '2026-10-04T00:00:00Z'] as const;
    expect(sprintTimeline(...weekend, new Date(2026, 8, 1))).toEqual({
      workingDays: 0, daysElapsed: 0, daysLeft: 0, timeElapsedPct: 0, state: 'not started',
    });
  });

  it('compares delivered share with elapsed time', () => {
    expect(pace(40.8, 90)).toEqual({ expectedDonePct: 90, actualDonePct: 40.8, gap: -49.2, status: 'behind' });
    expect(pace(55, 50).status).toBe('ahead');
    expect(pace(45, 50).status).toBe('on track');
  });

  it('never looks past now for the end of today', () => {
    const now = new Date(2026, 9, 2, 10);
    expect(endOfDayOrNow(new Date(2026, 9, 2), now)).toEqual(now);
    expect(endOfDayOrNow(new Date(2026, 9, 1), now)).toEqual(new Date(2026, 9, 1, 23, 59, 59));
  });
});

describe('durations', () => {
  it('interpolates percentiles and summarizes in days', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(summarizeDays([4, 1, 2, 3])).toEqual({ items: 4, avg: 2.5, median: 2.5, p85: 3.6, max: 4 });
    expect(summarizeDays([])).toEqual({ items: 0, avg: 0, median: 0, p85: 0, max: 0 });
  });

  it('measures lead and cycle time, skipping an activation after the close', () => {
    expect(itemDurations({ CreatedDate: '2026-09-01T00:00:00Z', ActivatedDate: '2026-09-03T00:00:00Z', ClosedDate: '2026-09-05T12:00:00Z' }))
      .toEqual({ lead: 4.5, cycle: 2.5 });
    expect(itemDurations({ CreatedDate: '2026-09-01T00:00:00Z', ActivatedDate: '2026-09-09T00:00:00Z', ClosedDate: '2026-09-05T00:00:00Z' }))
      .toEqual({ lead: 4, cycle: undefined });
  });
});

describe('board habits', () => {
  const HOUR = 1 / 24;

  it('flags cycle time when cards enter in progress right before closing', () => {
    const habits = boardHabits([
      { lead: 5, cycle: 0.5 * HOUR },
      { lead: 3, cycle: 2 },
      { lead: 4, cycle: 0.1 * HOUR },
      { lead: 6 },
    ]);
    expect(habits).toMatchObject({ createdNearClose: 0, activatedNearClose: 2, neverActivated: 1 });
    expect(habits.caveat).toContain('66.7% of the activated items entered an in-progress state less than an hour before closing');
    expect(habits.caveat).toContain('Prefer lead time');
  });

  it('flags lead time too when cards are created after the work', () => {
    const habits = boardHabits([{ lead: 0.2 * HOUR, cycle: 0.1 * HOUR }, ...Array.from({ length: 4 }, () => ({ lead: 3, cycle: 2 }))]);
    expect(habits.caveat).toContain('20% were created less than an hour before closing');
  });

  it('adds no caveat when the board follows the work', () => {
    expect(boardHabits([{ lead: 5, cycle: 3 }, { lead: 2, cycle: 1 }])).toEqual({ createdNearClose: 0, activatedNearClose: 0, neverActivated: 0 });
  });
});

describe('weeks', () => {
  it('labels ISO weeks', () => {
    expect(isoWeek(new Date(2026, 8, 28))).toBe('2026-W40');
    expect(isoWeek(new Date(2026, 0, 1))).toBe('2026-W01');
    expect(isoWeek(new Date(2027, 0, 3))).toBe('2026-W53');
  });

  it('counts deliveries per week, the current one flagged', () => {
    const now = new Date(2026, 9, 2, 12);
    const closed = [new Date(2026, 8, 22, 10).toISOString(), new Date(2026, 8, 30, 10).toISOString(), new Date(2026, 9, 1, 10).toISOString()];
    expect(weeklyThroughput(closed, 2, now)).toEqual([
      { week: '2026-W39', from: '2026-09-21', done: 1, current: false },
      { week: '2026-W40', from: '2026-09-28', done: 2, current: true },
    ]);
  });
});

describe('aging', () => {
  it('measures age and time in the current state in whole days', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(ageOf({ CreatedDate: '2026-09-01T12:00:00Z', StateChangeDate: '2026-09-25T12:00:00Z', ChangedDate: '2026-10-01T12:00:00Z' }, now))
      .toEqual({ ageDays: 31, daysInState: 7, daysSinceChange: 1 });
  });

  it('spreads values over ranges, the last one open-ended', () => {
    expect(distribution([0, 7, 8, 30, 91, 400])).toEqual([
      { days: '0-7', items: 2 },
      { days: '8-14', items: 1 },
      { days: '15-30', items: 1 },
      { days: '31-90', items: 0 },
      { days: '91+', items: 2 },
    ]);
  });
});

describe('carry-over', () => {
  it('counts every earlier sprint an item was still unfinished in at its end', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const ends = [
      { name: 'Sprint 80', unfinished: new Set([1]) },
      { name: 'Sprint 81', unfinished: new Set([1, 2]) },
    ];
    expect(carriedIn(rows, ends).map(c => [c.row.id, c.previous])).toEqual([
      [1, ['Sprint 80', 'Sprint 81']],
      [2, ['Sprint 81']],
    ]);
  });

  it('recognises a backlog sprint by name or path', () => {
    expect(isBacklogSprint('Demo\\Sprint 100', ['Sprint 100'])).toBe(true);
    expect(isBacklogSprint('Sprint 100', ['demo\\sprint 100'])).toBe(false);
    expect(isBacklogSprint('Demo\\Sprint 100', ['Demo\\Sprint 100'])).toBe(true);
    expect(isBacklogSprint('Demo\\Sprint 10', ['Sprint 100'])).toBe(false);
  });
});
