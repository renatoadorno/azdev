import { defineCommand } from 'citty';
import { BoardsSprintsService } from '../../services/BoardsSprintsService';
import { globalOptions, runService } from '../command';
import { loadOperationalTypes } from '../flows';
import { parseCsv } from '../parsers';

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
  subCommands: { list, current, items, summary, capacity },
});
