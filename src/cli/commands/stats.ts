import { defineCommand } from 'citty';
import { StatsService } from '../../services/StatsService';
import { globalOptions, runService } from '../command';
import { loadOptionalFlows } from '../flows';
import { failUsage, parseCount, parseCsv } from '../parsers';
import { statsFilterArgs, statsFilters } from '../statsArgs';

const teamIdArg = { type: 'string' as const, description: 'Team ID (optional; its sprints are used)' };

const throughput = defineCommand({
  meta: { name: 'throughput', description: 'Delivered items per sprint (planned vs done at its end) or per week, with average and median' },
  args: {
    ...globalOptions,
    by: { type: 'string', description: "'sprint' (default) or 'week'", default: 'sprint' },
    last: { type: 'string', description: 'How many sprints or weeks, the current one included', default: '6' },
    ...statsFilterArgs,
    teamId: teamIdArg,
  },
  async run({ args }) {
    if (args.by !== 'sprint' && args.by !== 'week') failUsage(`--by must be 'sprint' or 'week' (got '${args.by}')`);
    const last = parseCount(args.last, '--last');
    if (!last) failUsage('--last must be at least 1');
    const backlogSprints = loadOptionalFlows()?.backlogSprints;
    await runService(StatsService, args, (svc) =>
      svc.throughput({ by: args.by as 'sprint' | 'week', last, backlogSprints, teamId: args.teamId, ...statsFilters(args) }),
    );
  },
});

const cycleTime = defineCommand({
  meta: {
    name: 'cycle-time',
    description: 'Lead time (created → closed) and cycle time (activated → closed) of delivered items: average, median, p85, by type or assignee, slowest items',
  },
  args: {
    ...globalOptions,
    since: { type: 'string', description: 'Items closed since: 90d (default), 3m, 1y or YYYY-MM-DD' },
    sprint: { type: 'string', description: 'Items of this sprint instead of a period' },
    by: { type: 'string', description: "'type' (default), 'assignedTo' or 'none'", default: 'type' },
    ...statsFilterArgs,
    teamId: teamIdArg,
  },
  async run({ args }) {
    if (args.since && args.sprint) failUsage('Pass --since or --sprint, not both');
    if (!['type', 'assignedTo', 'none'].includes(args.by!)) failUsage(`--by must be 'type', 'assignedTo' or 'none' (got '${args.by}')`);
    await runService(StatsService, args, (svc) =>
      svc.cycleTime({ since: args.since, sprint: args.sprint, by: args.by as 'type' | 'assignedTo' | 'none', teamId: args.teamId, ...statsFilters(args) }),
    );
  },
});

const aging = defineCommand({
  meta: {
    name: 'aging',
    description: 'Open items by how long they sit in their current state (oldest first), with a distribution; backlog sprints of flows.json left out',
  },
  args: {
    ...globalOptions,
    sprint: { type: 'string', description: "Only this sprint ('current', 82, Sprint 82)" },
    state: { type: 'string', description: 'Only these states, comma-separated' },
    inProgress: { type: 'boolean', description: 'Only items already started (what is stuck, not what waits to start)' },
    minDays: { type: 'string', description: 'Only items at least this many days in their current state' },
    top: { type: 'string', description: 'How many items to list', default: '20' },
    includeParked: { type: 'boolean', description: 'Keep the items of the backlogSprints of flows.json' },
    ...statsFilterArgs,
    teamId: teamIdArg,
  },
  async run({ args }) {
    const minDays = parseCount(args.minDays, '--minDays');
    const top = parseCount(args.top, '--top');
    const backlogSprints = loadOptionalFlows()?.backlogSprints;
    await runService(StatsService, args, (svc) =>
      svc.aging({
        sprint: args.sprint,
        states: parseCsv(args.state),
        inProgress: args.inProgress,
        minDays,
        top,
        includeParked: args.includeParked,
        backlogSprints,
        teamId: args.teamId,
        ...statsFilters(args),
      }),
    );
  },
});

export default defineCommand({
  meta: { name: 'stats', description: 'Delivery numbers over time: throughput, lead/cycle time, aging (sprint progress/carryover live under sprint)' },
  subCommands: { throughput, 'cycle-time': cycleTime, aging },
});
