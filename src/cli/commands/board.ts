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
  meta: { name: 'list', description: 'List all boards' },
  args: {
    ...globalOptions,
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getBoards({ teamId: args.teamId });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const columns = defineCommand({
  meta: { name: 'columns', description: 'Get board columns' },
  args: {
    ...globalOptions,
    boardId: { type: 'positional', description: 'Board ID', required: true },
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getBoardColumns({ boardId: args.boardId!, teamId: args.teamId });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const boardItems = defineCommand({
  meta: { name: 'items', description: 'Get board items' },
  args: {
    ...globalOptions,
    boardId: { type: 'positional', description: 'Board ID', required: true },
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getBoardItems({ boardId: args.boardId!, teamId: args.teamId });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const move = defineCommand({
  meta: { name: 'move', description: 'Move a card on the board' },
  args: {
    ...globalOptions,
    cardId: { type: 'positional', description: 'Work item ID to move', required: true },
    boardId: { type: 'string', description: 'Board ID', required: true },
    columnId: { type: 'string', description: 'Target column ID', required: true },
    teamId: { type: 'string', description: 'Team ID (optional)' },
    position: { type: 'string', description: 'Position in column (optional)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.moveCardOnBoard({
        workItemId: Number(args.cardId),
        boardId: args.boardId!,
        columnId: args.columnId!,
        teamId: args.teamId,
        position: args.position ? Number(args.position) : undefined,
      });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const members = defineCommand({
  meta: { name: 'members', description: 'Get team members' },
  args: {
    ...globalOptions,
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getTeamMembers({ teamId: args.teamId });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

export default defineCommand({
  meta: { name: 'board', description: 'Board commands' },
  subCommands: { list, columns, items: boardItems, move, members },
});
