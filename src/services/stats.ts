/**
 * Pure numbers behind the progress and flow commands: state buckets from the
 * process's state categories, percentages, working days, duration summaries,
 * weekly buckets, aging and carry-over between sprints.
 */

import { isoDay, startOfDay } from './queryBuilder';
import { REMOVED_STATE, isClosedState, wiqlEscape, type WorkItemRow as Row } from './workItemUtils';

const DAY_MS = 86_400_000;

/** Where a state sits in the work: not started, under way, delivered, or discarded. */
export type Bucket = 'todo' | 'doing' | 'done' | 'removed';

/** Work item type (lower case) → state (lower case) → category (Proposed, InProgress, Resolved, Completed, Removed). */
export type StateCategories = Map<string, Map<string, string>>;

export interface TypeWithStates {
  name?: string;
  states?: Array<{ name?: string; category?: string }>;
}

export function categoriesFrom(types: TypeWithStates[]): StateCategories {
  const categories: StateCategories = new Map();
  for (const type of types) {
    if (!type.name) continue;
    const states = new Map<string, string>();
    for (const s of type.states ?? []) if (s.name && s.category) states.set(s.name.toLowerCase(), s.category);
    categories.set(type.name.toLowerCase(), states);
  }
  return categories;
}

const BUCKET_OF_CATEGORY: Record<string, Bucket> = {
  Proposed: 'todo',
  InProgress: 'doing',
  Resolved: 'doing',
  Completed: 'done',
  Removed: 'removed',
};

/** Bucket of a state of a type; a state the process does not describe falls back on its name. */
export function bucketOf(categories: StateCategories, type: unknown, state: unknown): Bucket {
  const category = categories.get(String(type ?? '').toLowerCase())?.get(String(state ?? '').toLowerCase());
  if (category && BUCKET_OF_CATEGORY[category]) return BUCKET_OF_CATEGORY[category];
  if (state === REMOVED_STATE) return 'removed';
  return isClosedState(state) ? 'done' : 'todo';
}

/**
 * WIQL condition for items in the given buckets: one `(type IN … AND state IN …)`
 * per distinct state list, so a state named alike in two types is never confused.
 */
export function bucketCondition(categories: StateCategories, buckets: Bucket[], typeNames: Map<string, string>): string {
  const byStates = new Map<string, string[]>();
  for (const [type, states] of categories) {
    const names = [...states].filter(([, category]) => buckets.includes(BUCKET_OF_CATEGORY[category]!)).map(([state]) => state);
    if (names.length === 0) continue;
    const key = names.sort().join('\u0000');
    byStates.set(key, [...(byStates.get(key) ?? []), typeNames.get(type) ?? type]);
  }
  if (byStates.size === 0) return '[System.Id] < 0';
  const quote = (v: string) => `'${wiqlEscape(v)}'`;
  const parts = [...byStates].map(([key, types]) =>
    `([System.WorkItemType] IN (${types.map(quote).join(', ')}) AND [System.State] IN (${key.split('\u0000').map(quote).join(', ')}))`);
  return parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`;
}

/** Percentage with one decimal; 0 when there is nothing to divide by. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function daysBetween(from: string | Date, to: string | Date): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;
}

/** Counts per bucket; removed items are counted apart and left out of `items`. */
export interface Totals {
  items: number;
  todo: number;
  doing: number;
  done: number;
  donePct: number;
  removed: number;
}

export function totals(rows: Row[], bucket: (row: Row) => Bucket): Totals {
  const counts = { todo: 0, doing: 0, done: 0, removed: 0 };
  for (const row of rows) counts[bucket(row)]++;
  const items = counts.todo + counts.doing + counts.done;
  return { items, ...counts, donePct: pct(counts.done, items), removed: counts.removed };
}

/** Totals per value of `key` (type, assignee…), biggest first; removed items left out. */
export function breakdown(rows: Row[], key: string, bucket: (row: Row) => Bucket, label = key): Record<string, unknown>[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    if (bucket(row) === 'removed') continue;
    const value = String(row[key] ?? '') || '(none)';
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return [...groups]
    .map(([value, group]) => {
      const { items, todo, doing, done, donePct } = totals(group, bucket);
      return { [label]: value, items, todo, doing, done, donePct };
    })
    .sort((a, b) => (b.items as number) - (a.items as number) || String(a[label]).localeCompare(String(b[label])));
}

/**
 * Effort of the items, when the team estimates: Effort/Story Points planned and
 * delivered, Remaining Work still open. Undefined when no item carries a value.
 */
export function effortSummary(rows: Row[], bucket: (row: Row) => Bucket): Record<string, number> | undefined {
  const active = rows.filter(row => bucket(row) !== 'removed');
  const sized = active.filter(row => typeof (row.Effort ?? row.StoryPoints) === 'number');
  const open = active.filter(row => bucket(row) !== 'done' && typeof row.RemainingWork === 'number');
  if (sized.length === 0 && open.length === 0) return undefined;

  const size = (row: Row) => Number(row.Effort ?? row.StoryPoints);
  const planned = sized.reduce((sum, row) => sum + size(row), 0);
  const delivered = sized.filter(row => bucket(row) === 'done').reduce((sum, row) => sum + size(row), 0);
  return {
    ...(sized.length ? { planned: round1(planned), delivered: round1(delivered), deliveredPct: pct(delivered, planned) } : {}),
    ...(open.length ? { remainingWork: round1(open.reduce((sum, row) => sum + Number(row.RemainingWork), 0)) } : {}),
  };
}

/** Last instant of a local day, or `now` when that is earlier — the moment an ASOF query looks at. */
export function endOfDayOrNow(day: Date, now = new Date()): Date {
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
  return end < now ? end : now;
}

/** Calendar day of an iteration date: Azure DevOps stores them as UTC midnights. */
export function iterationDay(value: string | Date): Date {
  const d = new Date(value);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isWorkingDay(day: Date): boolean {
  const weekday = day.getDay();
  return weekday !== 0 && weekday !== 6;
}

/** Working days (Mon–Fri) from `start` to `end`, both included. */
export function workingDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  for (let day = startOfDay(start); day <= end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    if (isWorkingDay(day)) days.push(day);
  }
  return days;
}

export interface SprintTimeline {
  workingDays: number;
  /** Working days already over (today is still under way, so it does not count). */
  daysElapsed: number;
  daysLeft: number;
  timeElapsedPct: number;
  state: 'not started' | 'running' | 'finished';
}

export function sprintTimeline(startDate: string, finishDate: string, now = new Date()): SprintTimeline {
  const start = iterationDay(startDate);
  const finish = iterationDay(finishDate);
  const days = workingDays(start, finish);
  const today = startOfDay(now);
  const elapsed = days.filter(d => d < today).length;
  const state = today < start ? 'not started' : today > finish ? 'finished' : 'running';
  return {
    workingDays: days.length,
    daysElapsed: elapsed,
    daysLeft: days.length - elapsed,
    timeElapsedPct: pct(elapsed, days.length),
    state,
  };
}

/** Delivered share against elapsed time: ahead, on track or behind. */
export function pace(donePct: number, timeElapsedPct: number): { expectedDonePct: number; actualDonePct: number; gap: number; status: string } {
  const gap = round1(donePct - timeElapsedPct);
  const status = gap >= 5 ? 'ahead' : gap <= -10 ? 'behind' : 'on track';
  return { expectedDonePct: timeElapsedPct, actualDonePct: donePct, gap, status };
}

/** Linear-interpolation percentile (p in 0..100) of sorted values. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low);
}

export interface DurationSummary {
  items: number;
  avg: number;
  median: number;
  p85: number;
  max: number;
}

/** Summary of durations in days, one decimal. */
export function summarizeDays(values: number[]): DurationSummary {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { items: 0, avg: 0, median: 0, p85: 0, max: 0 };
  const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    items: sorted.length,
    avg: round1(avg),
    median: round1(percentile(sorted, 50)),
    p85: round1(percentile(sorted, 85)),
    max: round1(sorted[sorted.length - 1]!),
  };
}

/**
 * WIQL condition for items closed on or after `day`. A type that does not set
 * ClosedDate is caught by its state change; `deliveredAt` then tells the real day.
 */
export function closedSinceCondition(day: string): string {
  return `([Microsoft.VSTS.Common.ClosedDate] >= '${day}' OR [Microsoft.VSTS.Common.StateChangeDate] >= '${day}')`;
}

/** When a delivered item was closed: ClosedDate, else its last state change. */
export function deliveredAt(row: Row): string | undefined {
  const value = row.ClosedDate ?? row.StateChangeDate;
  return value ? new Date(value as string).toISOString() : undefined;
}

/** Lead time (created → closed) and cycle time (activated → closed) of a delivered item, in days. */
export function itemDurations(row: Row): { lead?: number; cycle?: number } {
  const closed = deliveredAt(row);
  if (!closed) return {};
  const lead = row.CreatedDate ? daysBetween(row.CreatedDate as string, closed) : undefined;
  const activated = row.ActivatedDate as string | undefined;
  const cycle = activated && daysBetween(activated, closed) >= 0 ? daysBetween(activated, closed) : undefined;
  return { lead, cycle };
}

/** A card created or activated less than this before its close was moved on the board after the work. */
const NEAR_CLOSE_DAYS = 1 / 24;
/** Shares past which the durations say more about board habits than about the work. */
const ACTIVATED_LATE_SHARE = 0.2;
const CREATED_LATE_SHARE = 0.1;

export interface BoardHabits {
  /** Created less than an hour before it closed: registered after the work. */
  createdNearClose: number;
  /** Entered an in-progress state less than an hour before it closed. */
  activatedNearClose: number;
  /** Closed without ever entering an in-progress state. */
  neverActivated: number;
  caveat?: string;
}

/**
 * How far lead and cycle time can be trusted: cycle time starts when a card
 * enters an in-progress state, so a team that moves cards there right before
 * closing them gets a cycle time near zero whatever the work took.
 */
export function boardHabits(durations: Array<{ lead?: number; cycle?: number }>): BoardHabits {
  const items = durations.length;
  const activated = durations.filter(d => d.cycle !== undefined);
  const habits: BoardHabits = {
    createdNearClose: durations.filter(d => d.lead !== undefined && d.lead < NEAR_CLOSE_DAYS).length,
    activatedNearClose: activated.filter(d => d.cycle! < NEAR_CLOSE_DAYS).length,
    neverActivated: items - activated.length,
  };
  const lateActivation = activated.length > 0 && habits.activatedNearClose / activated.length >= ACTIVATED_LATE_SHARE;
  const lateCreation = items > 0 && habits.createdNearClose / items >= CREATED_LATE_SHARE;
  if (!lateActivation && !lateCreation) return habits;

  const parts = [
    ...(lateActivation ? [`${pct(habits.activatedNearClose, activated.length)}% of the activated items entered an in-progress state less than an hour before closing, so cycle time shows when the board was updated rather than how long the work took`] : []),
    ...(lateCreation ? [`${pct(habits.createdNearClose, items)}% were created less than an hour before closing (registered after the work), which shortens lead time too`] : []),
  ];
  return { ...habits, caveat: `${parts.join('; ')}. Prefer lead time, and state this when presenting the numbers.` };
}

/** Monday of the week `date` falls in. */
export function weekStart(date: Date): Date {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - offset);
}

/** ISO-8601 week label, e.g. `2026-W40`. */
export function isoWeek(date: Date): string {
  const thursday = new Date(weekStart(date));
  thursday.setDate(thursday.getDate() + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round((daysBetween(weekStart(firstThursday), weekStart(thursday))) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Delivered items per week over the last `weeks` weeks (the current one included, flagged). */
export function weeklyThroughput(closedDates: string[], weeks: number, now = new Date()): Array<{ week: string; from: string; done: number; current: boolean }> {
  const thisWeek = weekStart(now);
  const rows = Array.from({ length: weeks }, (_, i) => {
    const from = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - 7 * (weeks - 1 - i));
    return { week: isoWeek(from), from: isoDay(from), done: 0, current: i === weeks - 1 };
  });
  const index = new Map(rows.map((r, i) => [r.from, i]));
  for (const date of closedDates) {
    const i = index.get(isoDay(weekStart(new Date(date))));
    if (i !== undefined) rows[i]!.done++;
  }
  return rows;
}

/** Mean and median of `values`, one decimal. */
export function meanMedian(values: number[]): { avg: number; median: number } {
  if (values.length === 0) return { avg: 0, median: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return { avg: round1(sorted.reduce((s, v) => s + v, 0) / sorted.length), median: round1(percentile(sorted, 50)) };
}

/** Age, time in the current state and time since the last change of an open item, in whole days. */
export function ageOf(row: Row, now = new Date()): { ageDays: number; daysInState: number; daysSinceChange: number } {
  const days = (value: unknown) => (value ? Math.floor(daysBetween(value as string, now)) : 0);
  return {
    ageDays: days(row.CreatedDate),
    daysInState: days(row.StateChangeDate ?? row.CreatedDate),
    daysSinceChange: days(row.ChangedDate),
  };
}

/** How many values fall in each range: `0-7`, `8-14`, … and the last one open-ended. */
export function distribution(values: number[], edges = [7, 14, 30, 90]): Array<{ days: string; items: number }> {
  const ranges = edges.map((edge, i) => ({ days: `${i === 0 ? 0 : edges[i - 1]! + 1}-${edge}`, max: edge, items: 0 }));
  const last = { days: `${edges[edges.length - 1]! + 1}+`, max: Infinity, items: 0 };
  for (const value of values) (ranges.find(r => value <= r.max) ?? last).items++;
  return [...ranges, last].map(({ days, items }) => ({ days, items }));
}

/** A finished sprint and the items still unfinished in it when it ended. */
export interface SprintEnd {
  name: string;
  unfinished: Set<number>;
}

export interface CarriedItem {
  row: Row;
  /** Earlier sprints the item was still unfinished in at their end, oldest first. */
  previous: string[];
}

/**
 * Items of a sprint that came from earlier ones: each earlier sprint (oldest first)
 * where the item was still unfinished at the end counts as one carry-over.
 */
export function carriedIn(rows: Row[], earlier: SprintEnd[]): CarriedItem[] {
  return rows
    .map(row => ({ row, previous: earlier.filter(s => s.unfinished.has(row.id!)).map(s => s.name) }))
    .filter(item => item.previous.length > 0)
    .sort((a, b) => b.previous.length - a.previous.length || a.row.id! - b.row.id!);
}

/** `Demo\\Sprint 100` or `Sprint 100` matches the backlog sprint `sprint 100`. */
export function isBacklogSprint(pathOrName: unknown, backlogSprints: string[]): boolean {
  const value = String(pathOrName ?? '').toLowerCase();
  const name = value.split('\\').pop();
  return backlogSprints.some(b => {
    const target = b.toLowerCase();
    return target === value || target === name;
  });
}
