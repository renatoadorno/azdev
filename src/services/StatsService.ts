import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import type {
  AgingParams,
  CycleTimeParams,
  SprintCarryoverParams,
  SprintProgressParams,
  StatsFilters,
  StoryProgressParams,
  ThroughputParams,
} from '../interfaces/Stats';
import { AzureDevOpsService } from './AzureDevOpsService';
import { fitsAnyCard } from './flowRules';
import { buildWiql, groupCounts, isoDay, parseSince, queryConditions, startOfDay } from './queryBuilder';
import {
  ageOf,
  boardHabits,
  breakdown,
  bucketCondition,
  bucketOf,
  carriedIn,
  categoriesFrom,
  closedSinceCondition,
  deliveredAt,
  distribution,
  effortSummary,
  endOfDayOrNow,
  isBacklogSprint,
  itemDurations,
  iterationDay,
  meanMedian,
  pace,
  pct,
  round1,
  sprintTimeline,
  summarizeDays,
  totals,
  weekStart,
  weeklyThroughput,
  workingDays,
  type Bucket,
  type StateCategories,
} from './stats';
import { HIERARCHY_FORWARD, wiqlEscape, type WorkItemRow as Row } from './workItemUtils';

const DEFAULT_SPRINT = 'current';

const PROGRESS_FIELDS = [
  'System.Id',
  'System.WorkItemType',
  'System.State',
  'System.Title',
  'System.AssignedTo',
  'System.Parent',
  'System.IterationPath',
  'System.CreatedDate',
  'System.ChangedDate',
  'Microsoft.VSTS.Common.ActivatedDate',
  'Microsoft.VSTS.Common.ClosedDate',
  'Microsoft.VSTS.Common.StateChangeDate',
];

/** Estimates some processes carry; only the ones the project has are fetched. */
const EFFORT_FIELDS = [
  'Microsoft.VSTS.Scheduling.Effort',
  'Microsoft.VSTS.Scheduling.StoryPoints',
  'Microsoft.VSTS.Scheduling.RemainingWork',
];

/** Parallel requests at most, so a long lookback does not flood the API. */
const CONCURRENCY = 6;

const ACTIVE: Bucket[] = ['todo', 'doing', 'done'];
const UNFINISHED: Bucket[] = ['todo', 'doing'];

interface TeamSprint {
  name: string;
  path: string;
  start: Date;
  finish: Date;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function sprintName(path: unknown): string {
  return String(path ?? '').split('\\').pop() ?? '';
}

/** One line per item: what it is, who has it, where it is. */
function brief(row: Row): Row {
  return {
    id: row.id,
    type: row.WorkItemType,
    state: row.State,
    title: row.Title,
    assignedTo: row.AssignedTo ?? '',
  };
}

export class StatsService extends AzureDevOpsService {
  private categoriesPromise?: Promise<{ categories: StateCategories; typeNames: Map<string, string> }>;
  private sprintsPromise?: Promise<TeamSprint[]>;

  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  /** State categories of every type — what "done" means for a custom state like `staging`. */
  private stateCategories(): Promise<{ categories: StateCategories; typeNames: Map<string, string> }> {
    this.categoriesPromise ??= this.getWorkItemTrackingApi()
      .then(witApi => witApi.getWorkItemTypes(this.config.project))
      .then(types => ({
        categories: categoriesFrom(types ?? []),
        typeNames: new Map((types ?? []).filter(t => t.name).map(t => [t.name!.toLowerCase(), t.name!])),
      }));
    return this.categoriesPromise;
  }

  private async bucketFn(): Promise<(row: Row) => Bucket> {
    const { categories } = await this.stateCategories();
    return row => bucketOf(categories, row.WorkItemType, row.State);
  }

  private async inBuckets(buckets: Bucket[]): Promise<string> {
    const { categories, typeNames } = await this.stateCategories();
    return bucketCondition(categories, buckets, typeNames);
  }

  private async fieldsWithEffort(): Promise<string[]> {
    const known = new Set((await this.projectFields()).map(f => f.referenceName));
    return [...PROGRESS_FIELDS, ...EFFORT_FIELDS.filter(f => known.has(f))];
  }

  /** The team's sprints that have dates, oldest first. */
  private teamSprints(teamId?: string): Promise<TeamSprint[]> {
    this.sprintsPromise ??= this.getWorkApi()
      .then(workApi => workApi.getTeamIterations({ project: this.config.project, team: teamId }))
      .then(iterations => (iterations ?? [])
        .filter(i => i.path && i.attributes?.startDate && i.attributes?.finishDate)
        .map(i => ({
          name: i.name ?? sprintName(i.path),
          path: i.path!,
          start: iterationDay(i.attributes!.startDate!),
          finish: iterationDay(i.attributes!.finishDate!),
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime() || a.finish.getTime() - b.finish.getTime()));
    return this.sprintsPromise;
  }

  private filterConditions(f: StatsFilters): string[] {
    return queryConditions({ mine: f.mine, assignedTo: f.assignedTo, types: f.types, excludeTypes: f.excludeTypes });
  }

  private inSprint(path: string): string {
    return `[System.IterationPath] = '${wiqlEscape(path)}'`;
  }

  /** Ids matching the conditions, as the board was at `asOf` (now when omitted). */
  private idsMatching(conditions: string[], asOf?: Date): Promise<number[]> {
    const query = buildWiql(conditions, '[System.Id]');
    return this.queryIds(asOf ? `${query} ASOF '${asOf.toISOString()}'` : query);
  }

  // ---- sprint progress ----------------------------------------------------

  public async sprintProgress(params: SprintProgressParams): Promise<Record<string, unknown>> {
    const iteration = await this.resolveIteration(params.sprint ?? DEFAULT_SPRINT, params.teamId);
    const conditions = [this.inSprint(iteration.path!), ...this.filterConditions(params)];
    const rows = await this.hydrate(await this.idsMatching(conditions), await this.fieldsWithEffort());
    const bucket = await this.bucketFn();

    const sum = totals(rows, bucket);
    const dated = iteration.startDate && iteration.finishDate
      ? { start: iterationDay(iteration.startDate), finish: iterationDay(iteration.finishDate) }
      : undefined;
    const timeline = dated ? sprintTimeline(iteration.startDate!, iteration.finishDate!) : undefined;
    const effort = effortSummary(rows, bucket);
    const daily = params.daily && dated ? await this.dailyProgress(conditions, dated.start, dated.finish) : undefined;

    return {
      sprint: { name: iteration.name, ...(dated ? { startDate: isoDay(dated.start), finishDate: isoDay(dated.finish), ...timeline } : {}) },
      totals: sum,
      ...(timeline ? { pace: pace(sum.donePct, timeline.timeElapsedPct) } : {}),
      ...(effort ? { effort } : {}),
      byState: groupCounts(rows.filter(r => bucket(r) !== 'removed').map(r => ({ state: r.State, bucket: bucket(r) })), ['state', 'bucket']),
      byType: breakdown(rows, 'WorkItemType', bucket, 'type'),
      byAssignee: breakdown(rows, 'AssignedTo', bucket, 'assignedTo'),
      ...(daily ? { daily } : {}),
    };
  }

  /** Items and done items at the end of each working day of the sprint, up to today. */
  private async dailyProgress(conditions: string[], start: Date, finish: Date): Promise<Record<string, unknown>[]> {
    const today = startOfDay(new Date());
    const [all, done] = [await this.inBuckets(ACTIVE), await this.inBuckets(['done'])];
    return mapLimit(workingDays(start, finish < today ? finish : today), CONCURRENCY, async day => {
      const asOf = endOfDayOrNow(day);
      const [items, delivered] = await Promise.all([
        this.idsMatching([...conditions, all], asOf),
        this.idsMatching([...conditions, done], asOf),
      ]);
      return { date: isoDay(day), items: items.length, done: delivered.length, donePct: pct(delivered.length, items.length) };
    });
  }

  // ---- carry-over ---------------------------------------------------------

  public async sprintCarryover(params: SprintCarryoverParams): Promise<Record<string, unknown>> {
    const target = await this.resolveIteration(params.sprint ?? DEFAULT_SPRINT, params.teamId);
    if (!target.startDate || !target.finishDate) throw new Error(`Sprint "${target.name}" has no dates, so its earlier sprints are unknown`);
    const backlog = params.rules?.backlogSprints ?? [];
    const expected = params.rules?.expected ?? [];
    const start = iterationDay(target.startDate);
    const finish = iterationDay(target.finishDate);

    // Earlier means started before the target and over by its first day; overlapping sprints are not earlier.
    const before = (await this.teamSprints(params.teamId))
      .filter(s => s.path !== target.path && s.start < start && s.finish <= start && !isBacklogSprint(s.path, backlog));
    const earlier = before.slice(Math.max(0, before.length - (params.lookback ?? 6)));
    const unfinished = await this.inBuckets(UNFINISHED);
    const ends = await mapLimit(earlier, CONCURRENCY, async s => ({
      name: s.name,
      unfinished: new Set(await this.idsMatching([this.inSprint(s.path), unfinished], endOfDayOrNow(s.finish))),
    }));

    const current = [this.inSprint(target.path!), ...this.filterConditions(params), await this.inBuckets(params.openOnly ? UNFINISHED : ACTIVE)];
    const rows = await this.hydrate(await this.idsMatching(current), PROGRESS_FIELDS);
    const carried = carriedIn(rows, ends);
    const line = (item: (typeof carried)[number]) => ({ ...brief(item.row), carried: item.previous.length, from: item.previous.join(', ') });
    const counted = carried.filter(item => !fitsAnyCard(expected, item.row));
    const asExpected = carried.filter(item => fitsAnyCard(expected, item.row));

    const result: Record<string, unknown> = {
      sprint: target.name,
      lookedBack: earlier.map(s => s.name).join(', '),
      ...(backlog.length ? { backlogSprints: backlog.join(', ') } : {}),
      totals: {
        items: rows.length,
        carriedIn: counted.length,
        carriedInPct: pct(counted.length, rows.length),
        timesCarried: counted.reduce((n, item) => n + item.previous.length, 0),
        expected: asExpected.length,
      },
      byAssignee: groupCounts(counted.map(item => ({ assignedTo: item.row.AssignedTo ?? '' })), ['assignedTo']),
      carriedIn: counted.map(line),
      ...(asExpected.length ? { expected: asExpected.map(line) } : {}),
    };

    // A finished sprint also tells where its unfinished items went.
    if (finish < startOfDay(new Date())) {
      const leftIds = await this.idsMatching(
        [this.inSprint(target.path!), ...this.filterConditions(params), unfinished],
        endOfDayOrNow(finish),
      );
      const left = await this.hydrate(leftIds, PROGRESS_FIELDS);
      const bucket = await this.bucketFn();
      const kindOf = (row: Row): string => {
        if (bucket(row) === 'removed') return 'removed';
        if (row.IterationPath === target.path) return bucket(row) === 'done' ? 'closed late' : 'still open';
        if (fitsAnyCard(expected, row)) return 'expected';
        return isBacklogSprint(row.IterationPath, backlog) ? 'parked' : 'moved';
      };
      const kinds = ['moved', 'parked', 'expected', 'closed late', 'still open', 'removed'];
      const out = left
        .map(row => ({ ...brief(row), kind: kindOf(row), nowIn: sprintName(row.IterationPath) }))
        .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || (a.id as number) - (b.id as number));
      return {
        ...result,
        carriedOut: {
          unfinishedAtEnd: left.length,
          ...Object.fromEntries(kinds.map(k => [k, out.filter(o => o.kind === k).length])),
          items: out,
        },
      };
    }
    return result;
  }

  // ---- story progress -----------------------------------------------------

  public async storyProgress(params: StoryProgressParams): Promise<Record<string, unknown>> {
    const fields = await this.fieldsWithEffort();
    const [story] = await this.hydrate([params.id], fields);
    if (!story) throw new Error(`Work item ${params.id} not found`);

    const tree = await this.runWiql(
      `SELECT [System.Id] FROM WorkItemLinks WHERE ([Source].[System.Id] = ${params.id}) AND ([System.Links.LinkType] = '${HIERARCHY_FORWARD}') MODE (Recursive)`,
    );
    const ids = [...new Set((tree.workItemRelations ?? []).map(r => r.target?.id).filter((id): id is number => typeof id === 'number' && id !== params.id))];
    const rows = await this.hydrate(ids, fields);
    const bucket = await this.bucketFn();
    const now = new Date();

    const active = rows.filter(r => bucket(r) !== 'removed');
    const firstActivity = [story, ...active].map(r => r.ActivatedDate as string | undefined).filter(Boolean).sort()[0];
    const lastDelivery = active.filter(r => bucket(r) === 'done').map(deliveredAt).filter(Boolean).sort().pop();
    const lead = bucket(story) === 'done' ? itemDurations(story).lead : undefined;
    const effort = effortSummary(rows, bucket);

    return {
      story: {
        ...brief(story),
        sprint: sprintName(story.IterationPath),
        ageDays: ageOf(story, now).ageDays,
        ...(lead !== undefined ? { leadTimeDays: round1(lead) } : {}),
        ...(firstActivity ? { firstActivity: firstActivity.slice(0, 10) } : {}),
        ...(lastDelivery ? { lastDelivery: lastDelivery.slice(0, 10) } : {}),
      },
      totals: totals(rows, bucket),
      ...(effort ? { effort } : {}),
      sprints: [...new Set(active.map(r => sprintName(r.IterationPath)).filter(Boolean))].join(', '),
      byType: breakdown(rows, 'WorkItemType', bucket, 'type'),
      byAssignee: breakdown(rows, 'AssignedTo', bucket, 'assignedTo'),
      open: active
        .filter(r => bucket(r) !== 'done')
        .map(r => ({ ...brief(r), sprint: sprintName(r.IterationPath), ...ageOf(r, now) }))
        .sort((a, b) => b.daysInState - a.daysInState),
    };
  }

  // ---- throughput ---------------------------------------------------------

  public async throughput(params: ThroughputParams): Promise<Record<string, unknown>> {
    const filters = this.filterConditions(params);
    const done = await this.inBuckets(['done']);

    if (params.by === 'week') {
      const thisWeek = weekStart(new Date());
      const since = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - 7 * (params.last - 1));
      const ids = await this.idsMatching([done, closedSinceCondition(isoDay(since)), ...filters]);
      const rows = await this.hydrate(ids, ['System.Id', 'Microsoft.VSTS.Common.ClosedDate', 'Microsoft.VSTS.Common.StateChangeDate']);
      const weeks = weeklyThroughput(rows.map(deliveredAt).filter((d): d is string => !!d && new Date(d) >= since), params.last);
      return { by: 'week', weeks, ...meanMedianOf(weeks.filter(w => !w.current).map(w => w.done)) };
    }

    const today = startOfDay(new Date());
    const backlog = params.backlogSprints ?? [];
    const sprints = (await this.teamSprints(params.teamId))
      .filter(s => s.start <= today && !isBacklogSprint(s.path, backlog))
      .slice(-params.last);
    const all = await this.inBuckets(ACTIVE);
    const rows = await mapLimit(sprints, CONCURRENCY, async s => {
      const asOf = endOfDayOrNow(s.finish);
      const [planned, delivered] = await Promise.all([
        this.idsMatching([this.inSprint(s.path), all, ...filters], asOf),
        this.idsMatching([this.inSprint(s.path), done, ...filters], asOf),
      ]);
      return {
        sprint: s.name,
        start: isoDay(s.start),
        finish: isoDay(s.finish),
        planned: planned.length,
        done: delivered.length,
        donePct: pct(delivered.length, planned.length),
        notDone: planned.length - delivered.length,
        // Still running: left out of the averages, which compare finished sprints only.
        current: s.finish >= today,
      };
    });
    const finished = rows.filter(r => !r.current);
    return {
      by: 'sprint',
      sprints: rows,
      ...meanMedianOf(finished.map(r => r.done)),
      avgDonePct: finished.length ? round1(finished.reduce((s, r) => s + r.donePct, 0) / finished.length) : 0,
    };
  }

  // ---- cycle time ---------------------------------------------------------

  public async cycleTime(params: CycleTimeParams): Promise<Record<string, unknown>> {
    const iteration = params.sprint ? await this.resolveIteration(params.sprint, params.teamId) : undefined;
    const since = parseSince(params.since ?? '90d');
    const closedSince = isoDay(since);
    const scope = iteration ? this.inSprint(iteration.path!) : closedSinceCondition(closedSince);
    const ids = await this.idsMatching([await this.inBuckets(['done']), scope, ...this.filterConditions(params)]);
    const rows = (await this.hydrate(ids, PROGRESS_FIELDS))
      // The query also takes items whose state changed lately; keep only those delivered in the period.
      .filter(row => iteration || new Date(deliveredAt(row) ?? 0) >= since)
      .map(row => ({ row, ...itemDurations(row) }));

    const lead = rows.map(r => r.lead).filter((d): d is number => d !== undefined);
    const cycle = rows.map(r => r.cycle).filter((d): d is number => d !== undefined);
    const by = params.by ?? 'type';
    const key = by === 'assignedTo' ? 'AssignedTo' : 'WorkItemType';
    const groups = new Map<string, typeof rows>();
    if (by !== 'none') {
      for (const r of rows) {
        const value = String(r.row[key] ?? '') || '(none)';
        groups.set(value, [...(groups.get(value) ?? []), r]);
      }
    }

    return {
      ...(iteration ? { sprint: iteration.name } : { closedSince }),
      items: rows.length,
      leadTimeDays: summarizeDays(lead),
      cycleTimeDays: summarizeDays(cycle),
      boardHabits: boardHabits(rows),
      ...(by !== 'none' ? {
        [by === 'assignedTo' ? 'byAssignee' : 'byType']: [...groups]
          .map(([value, group]) => {
            const l = summarizeDays(group.map(g => g.lead).filter((d): d is number => d !== undefined));
            const c = summarizeDays(group.map(g => g.cycle).filter((d): d is number => d !== undefined));
            return { [by]: value, items: group.length, leadMedian: l.median, leadP85: l.p85, cycleMedian: c.median, cycleP85: c.p85 };
          })
          .sort((a, b) => b.items - a.items),
      } : {}),
      slowest: [...rows]
        .sort((a, b) => (b.cycle ?? b.lead ?? 0) - (a.cycle ?? a.lead ?? 0))
        .slice(0, 5)
        .map(r => ({ ...brief(r.row), cycleDays: r.cycle === undefined ? '' : round1(r.cycle), leadDays: r.lead === undefined ? '' : round1(r.lead) })),
    };
  }

  // ---- aging --------------------------------------------------------------

  public async aging(params: AgingParams): Promise<Record<string, unknown>> {
    const conditions = [await this.inBuckets(params.inProgress ? ['doing'] : UNFINISHED), ...this.filterConditions(params)];
    if (params.sprint) conditions.push(this.inSprint((await this.resolveIteration(params.sprint, params.teamId)).path!));
    if (params.states?.length) conditions.push(queryConditions({ states: params.states })[0]!);
    const rows = await this.hydrate(await this.idsMatching(conditions), PROGRESS_FIELDS);

    const backlog = params.backlogSprints ?? [];
    const parked = new Set(params.includeParked ? [] : rows.filter(r => isBacklogSprint(r.IterationPath, backlog)));
    const now = new Date();
    const today = startOfDay(now);
    // An open item in a sprint already over was left behind: nobody carried it on.
    const finished = new Set((await this.teamSprints(params.teamId)).filter(s => s.finish < today).map(s => s.path));
    const aged = rows
      .filter(r => !parked.has(r))
      .map(r => ({ ...brief(r), sprint: sprintName(r.IterationPath), sprintOver: finished.has(String(r.IterationPath)), ...ageOf(r, now) }))
      .filter(r => r.daysInState >= (params.minDays ?? 0))
      .sort((a, b) => b.daysInState - a.daysInState || b.ageDays - a.ageDays);

    return {
      open: aged.length,
      inFinishedSprints: aged.filter(r => r.sprintOver).length,
      ...(parked.size ? { parkedLeftOut: parked.size } : {}),
      daysInState: summarizeDays(aged.map(r => r.daysInState)),
      distribution: distribution(aged.map(r => r.daysInState)),
      items: aged.slice(0, params.top ?? 20),
    };
  }
}

function meanMedianOf(values: number[]): { avgDone: number; medianDone: number } {
  const { avg, median } = meanMedian(values);
  return { avgDone: avg, medianDone: median };
}
