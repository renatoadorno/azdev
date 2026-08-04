import { defineCommand } from 'citty';
import { BoardsSprintsService } from '../../services/BoardsSprintsService';
import { loadCliConfig } from '../config';
import { exitWithError } from '../errors';
import { format } from '../formatters/index';
import { parseId } from '../parsers';

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
    } catch (err) {
      exitWithError(err);
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
    } catch (err) {
      exitWithError(err);
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
    } catch (err) {
      exitWithError(err);
    }
  },
});

const move = defineCommand({
  meta: { name: 'move', description: 'Move a card on the board' },
  args: {
    ...globalOptions,
    cardId: { type: 'positional', description: 'Work item ID to move', required: true },
    boardId: { type: 'string', description: 'Board ID', required: true },
    columnId: { type: 'string', description: 'Target column (accepts column ID or column name)', required: true },
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    const workItemId = parseId(args.cardId, 'card ID');
    try {
      const svc = getService(args);
      const result = await svc.moveCardOnBoard({
        workItemId,
        boardId: args.boardId!,
        columnId: args.columnId!,
        teamId: args.teamId,
      });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
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
    } catch (err) {
      exitWithError(err);
    }
  },
});

export default defineCommand({
  meta: { name: 'board', description: 'Board commands' },
  subCommands: { list, columns, items: boardItems, move, members },
});
