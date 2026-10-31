import type { Meta, SprintInfo, StateInfo, TypeInfo } from '../interfaces/Serve';
import type { RawMeta, RawSprint, RawType } from '../interfaces/Sync';
import { UNKNOWN_CATEGORY } from './categories';

function toTypeInfo(type: RawType): TypeInfo {
  const transitions: Record<string, string[]> = {};
  for (const [from, targets] of Object.entries(type.transitions ?? {})) {
    transitions[from] = targets.map(t => t.to).filter((to): to is string => Boolean(to));
  }
  return {
    name: type.name!,
    ...(type.color ? { color: type.color } : {}),
    states: (type.states ?? [])
      .filter(s => s.name)
      .map(s => ({ name: s.name!, category: s.category ?? UNKNOWN_CATEGORY, ...(s.color ? { color: s.color } : {}) })),
    transitions,
  };
}

function toSprintInfo(sprint: RawSprint): SprintInfo {
  return {
    ...(sprint.id ? { id: sprint.id } : {}),
    name: sprint.name ?? sprint.path!.split('\\').pop()!,
    path: sprint.path!,
    ...(sprint.startDate ? { start: sprint.startDate } : {}),
    ...(sprint.finishDate ? { finish: sprint.finishDate } : {}),
    ...(sprint.timeframe ? { timeframe: sprint.timeframe } : {}),
  };
}

/**
 * Every iteration of the project, with the team's timeframe where it has one.
 * The project root (a path without a backslash) is no sprint: cards there are in
 * the backlog.
 */
function mergeSprints(team: RawSprint[], project: RawSprint[]): SprintInfo[] {
  const byPath = new Map<string, RawSprint>();
  for (const sprint of [...project, ...team]) {
    if (!sprint.path?.includes('\\')) continue;
    const key = sprint.path.toLowerCase();
    byPath.set(key, { ...byPath.get(key), ...Object.fromEntries(Object.entries(sprint).filter(([, v]) => v !== undefined)) });
  }
  return [...byPath.values()].map(toSprintInfo).sort((a, b) => {
    if (a.start && b.start) return a.start.localeCompare(b.start) || a.path.localeCompare(b.path);
    if (a.start || b.start) return a.start ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

export function buildMeta(raw: RawMeta, context: { orgUrl: string; project: string; now: Date }): Meta {
  return {
    orgUrl: context.orgUrl,
    project: context.project,
    me: { id: raw.me.id, name: raw.me.name, email: raw.me.email },
    types: raw.types.filter(t => t.name && !t.isDisabled).map(toTypeInfo),
    sprints: mergeSprints(raw.teamSprints, raw.projectSprints),
    members: [...raw.members].sort((a, b) => a.name.localeCompare(b.name)),
    tags: [...raw.tags].sort((a, b) => a.localeCompare(b)),
    areas: [...raw.areas],
    fetchedAt: context.now.toISOString(),
  };
}

/** The team's current sprint, or failing a timeframe, the one whose dates hold `now`. */
export function currentSprint(meta: Meta, now = new Date()): SprintInfo | undefined {
  const byTimeframe = meta.sprints.find(s => s.timeframe === 'current');
  if (byTimeframe) return byTimeframe;
  const at = now.toISOString();
  return meta.sprints.find(s => s.start && s.finish && s.start <= at && at <= s.finish);
}

/** The last sprint that ended before the current one began. */
export function previousSprint(meta: Meta, now = new Date()): SprintInfo | undefined {
  const current = currentSprint(meta, now);
  const before = current?.start ?? now.toISOString();
  const past = meta.sprints.filter(s => (s.timeframe ? s.timeframe === 'past' : Boolean(s.finish && s.finish < before)));
  return past.sort((a, b) => (a.finish ?? '').localeCompare(b.finish ?? '')).pop();
}

/** (type, state) → its category and color, case-insensitive. */
export function stateLookup(meta: Meta): (type: string, state: string) => StateInfo | undefined {
  const byType = new Map(meta.types.map(t => [t.name.toLowerCase(), new Map(t.states.map(s => [s.name.toLowerCase(), s]))]));
  return (type, state) => byType.get(type.toLowerCase())?.get(state.toLowerCase());
}
