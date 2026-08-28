import { defineCommand } from 'citty';
import { BoardsSprintsService } from '../../services/BoardsSprintsService';
import { globalOptions, runService } from '../command';
import { parseId } from '../parsers';

const list = defineCommand({
  meta: { name: 'list', description: 'List all boards' },
  args: {
    ...globalOptions,
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) => svc.getBoards({ teamId: args.teamId }));
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
    await runService(BoardsSprintsService, args, (svc) => svc.getBoardColumns({ boardId: args.boardId!, teamId: args.teamId }));
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
    await runService(BoardsSprintsService, args, (svc) => svc.getBoardItems({ boardId: args.boardId!, teamId: args.teamId }));
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
    await runService(BoardsSprintsService, args, (svc) =>
      svc.moveCardOnBoard({
        workItemId,
        boardId: args.boardId!,
        columnId: args.columnId!,
        teamId: args.teamId,
      }),
    );
  },
});

const members = defineCommand({
  meta: { name: 'members', description: 'Get team members' },
  args: {
    ...globalOptions,
    teamId: { type: 'string', description: 'Team ID (optional)' },
  },
  async run({ args }) {
    await runService(BoardsSprintsService, args, (svc) => svc.getTeamMembers({ teamId: args.teamId }));
  },
});

export default defineCommand({
  meta: { name: 'board', description: 'Board commands' },
  subCommands: { list, columns, items: boardItems, move, members },
});
