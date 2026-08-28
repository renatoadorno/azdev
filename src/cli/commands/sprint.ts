import { defineCommand } from 'citty';
import { BoardsSprintsService } from '../../services/BoardsSprintsService';
import { globalOptions, runService } from '../command';

const list = defineCommand({
  meta: { name: 'list', description: 'List all sprints' },
  args: {
    ...globalOptions,
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) => svc.getSprints({ teamId: args.teamId }));
  },
});

const current = defineCommand({
  meta: { name: 'current', description: 'Get the current sprint' },
  args: {
    ...globalOptions,
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) => svc.getCurrentSprint({ teamId: args.teamId }));
  },
});

const items = defineCommand({
  meta: { name: 'items', description: 'Get work items in a sprint' },
  args: {
    ...globalOptions,
    sprintId: { type: 'positional', description: 'Sprint ID', required: true },
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) => svc.getSprintWorkItems({ sprintId: args.sprintId!, teamId: args.teamId }));
  },
});

const capacity = defineCommand({
  meta: { name: 'capacity', description: 'Get sprint capacity' },
  args: {
    ...globalOptions,
    sprintId: { type: 'positional', description: 'Sprint ID', required: true },
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) => svc.getSprintCapacity({ sprintId: args.sprintId!, teamId: args.teamId }));
  },
});

export default defineCommand({
  meta: { name: 'sprint', description: 'Sprint commands' },
  subCommands: { list, current, items, capacity },
});
