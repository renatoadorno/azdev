import { defineCommand } from 'citty';
import { BoardsSprintsService } from '../../services/BoardsSprintsService';
import { loadCliConfig } from '../config';
import { format } from '../formatters/index';

const globalOptions = {
  json: { type: 'boolean' as const, description: 'Output as JSON' },
  markdown: { type: 'boolean' as const, description: 'Output as Markdown' },
  project: { type: 'string' as const, description: 'Override project from config' },
};

function getService(options: { project?: string }) {
  const config = loadCliConfig();
  if (options.project) config.project = options.project;
  return new BoardsSprintsService(config);
}

const list = defineCommand({
  meta: { name: 'list', description: 'List all sprints' },
  args: {
    ...globalOptions,
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getSprints({ teamId: args.teamId });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const current = defineCommand({
  meta: { name: 'current', description: 'Get the current sprint' },
  args: {
    ...globalOptions,
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getCurrentSprint({ teamId: args.teamId });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.getSprintWorkItems({ sprintId: args.sprintId!, teamId: args.teamId });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.getSprintCapacity({ sprintId: args.sprintId!, teamId: args.teamId });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

export default defineCommand({
  meta: { name: 'sprint', description: 'Sprint commands' },
  subCommands: { list, current, items, capacity },
});
