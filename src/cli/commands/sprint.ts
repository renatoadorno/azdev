import { defineCommand } from 'citty';
import { BoardsSprintsService } from '../../services/BoardsSprintsService';
import { StatsService } from '../../services/StatsService';
import { expectedCarryoverCards } from '../../services/flowRules';
import { globalOptions, runService } from '../command';
import { loadOperationalTypes, loadOptionalFlows } from '../flows';
import { failUsage, parseCount, parseCsv } from '../parsers';
import { statsFilterArgs, statsFilters } from '../statsArgs';

const teamIdArg = { type: 'string' as const, description: 'Team ID (optional)' };
const sprintArg = {
  type: 'positional' as const,
  description: "Sprint: 'current' (default), a number (82), a name (Sprint 82), a path or a GUID",
  required: false,
};

const list = defineCommand({
  meta: { name: 'list', description: 'List all sprints' },
  args: {
    ...globalOptions,
    teamId: teamIdArg,
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) => svc.getSprints({ teamId: args.teamId }));
  },
});

const current = defineCommand({
  meta: { name: 'current', description: 'Get the current sprint' },
  args: {
    ...globalOptions,
    teamId: teamIdArg,
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) => svc.getCurrentSprint({ teamId: args.teamId }));
  },
});

const items = defineCommand({
  meta: { name: 'items', description: 'Work items in a sprint (hydrated rows), with assignee/type/state filters' },
  args: {
    ...globalOptions,
    sprint: sprintArg,
    mine: { type: 'boolean', description: 'Only items assigned to me' },
    assignedTo: { type: 'string', description: 'Only items assigned to this user (e-mail or name)' },
    type: { type: 'string', description: 'Work item type filter (e.g. Task)' },
    state: { type: 'string', description: 'Exact state filter' },
    open: { type: 'boolean', description: 'Exclude finished states (Done/Closed/Removed/Completed)' },
    teamId: teamIdArg,
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) =>
      svc.getSprintWorkItems({
        sprint: args.sprint,
        teamId: args.teamId,
        mine: args.mine,
        assignedTo: args.assignedTo,
        type: args.type,
        state: args.state,
        openOnly: args.open,
      }),
    );
  },
});

const summary = defineCommand({
  meta: {
    name: 'summary',
    description: "A person's delivery in a sprint grouped by story (parent), with the rest of each story's cycle and operational work apart",
  },
  args: {
    ...globalOptions,
    sprint: sprintArg,
    assignedTo: { type: 'string', description: 'Whose delivery (e-mail or name); default: you' },
    operational: {
      type: 'string',
      description: 'Comma-separated types kept apart from product work (default: operationalTypes in flows.json)',
    },
    teamId: teamIdArg,
  },
  async run({ args }) {
    const operationalTypes = parseCsv(args.operational) ?? loadOperationalTypes();
    await runService(BoardsSprintsService, args, (svc) =>
      svc.getSprintSummary({ sprint: args.sprint, assignedTo: args.assignedTo, operationalTypes, teamId: args.teamId }),
    );
  },
});

const progress = defineCommand({
  meta: {
    name: 'progress',
    description: 'How far a sprint is: done/doing/to do (by state category), % done against time elapsed, by type and by assignee; --daily adds a burn-up',
  },
  args: {
    ...globalOptions,
    sprint: sprintArg,
    ...statsFilterArgs,
    daily: { type: 'boolean', description: 'Add items and done items at the end of each working day (one query per day)' },
    teamId: teamIdArg,
  },
  async run({ args }) {
    await runService(StatsService, args, (svc) =>
      svc.sprintProgress({ sprint: args.sprint, daily: args.daily, teamId: args.teamId, ...statsFilters(args) }),
    );
  },
});

const carryover = defineCommand({
  meta: {
    name: 'carryover',
    description: 'Items a sprint carried in from earlier sprints (unfinished at their end) and, once it is over, where its unfinished items went',
  },
  args: {
    ...globalOptions,
    sprint: sprintArg,
    ...statsFilterArgs,
    open: { type: 'boolean', description: 'Only items not finished yet' },
    lookback: { type: 'string', description: 'How many earlier sprints to look back on', default: '6' },
    teamId: teamIdArg,
  },
  async run({ args }) {
    const lookback = parseCount(args.lookback, '--lookback');
    if (!lookback) failUsage('--lookback must be at least 1');
    const flows = loadOptionalFlows();
    await runService(StatsService, args, (svc) =>
      svc.sprintCarryover({
        sprint: args.sprint,
        lookback,
        openOnly: args.open,
        teamId: args.teamId,
        rules: { backlogSprints: flows?.backlogSprints ?? [], expected: expectedCarryoverCards(flows) },
        ...statsFilters(args),
      }),
    );
  },
});

const capacity = defineCommand({
  meta: { name: 'capacity', description: 'Get sprint capacity' },
  args: {
    ...globalOptions,
    sprint: sprintArg,
    teamId: teamIdArg,
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) => svc.getSprintCapacity({ sprint: args.sprint, teamId: args.teamId }));
  },
});

export default defineCommand({
  meta: { name: 'sprint', description: 'Sprint commands' },
  subCommands: { list, current, items, summary, progress, carryover, capacity },
});
