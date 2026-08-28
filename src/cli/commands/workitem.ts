import { defineCommand } from 'citty';
import { WorkItemService } from '../../services/WorkItemService';
import { slimWorkItem } from '../../services/workItemUtils';
import { globalOptions, runService } from '../command';
import { parseId } from '../parsers';

function parseCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

function parseRichTextFormat(value?: string): 'html' | 'markdown' | undefined {
  if (!value) return undefined;
  if (value !== 'html' && value !== 'markdown') {
    console.error(`--format must be 'html' or 'markdown' (got '${value}')`);
    process.exit(1);
  }
  return value;
}

const list = defineCommand({
  meta: { name: 'list', description: 'List work items via WIQL query' },
  args: {
    ...globalOptions,
    query: { type: 'string', description: 'WIQL query string', default: "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.CreatedDate] DESC" },
  },
  async run({ args }) {
    await runService(WorkItemService, args, (svc) => svc.listWorkItems(args.query!));
  },
});

const get = defineCommand({
  meta: { name: 'get', description: 'Get a work item by ID (slim view by default)' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    fields: { type: 'string', description: 'Comma-separated fields to show (e.g. title,state,assignedTo)' },
    raw: { type: 'boolean', description: 'Return the full raw work item (avatars, links, all fields)' },
  },
  async run({ args }) {
    const id = parseId(args.id);
    const fields = parseCsv(args.fields);
    await runService(WorkItemService, args, async (svc) => {
      const result = await svc.getWorkItemById({ id, fields });
      return args.raw ? result : slimWorkItem(result, fields);
    });
  },
});

const children = defineCommand({
  meta: { name: 'children', description: 'List children of a work item' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Parent work item ID', required: true },
    recursive: { type: 'boolean', description: 'Include the whole subtree, not just direct children' },
    mine: { type: 'boolean', description: 'Only items assigned to me' },
    open: { type: 'boolean', description: 'Exclude finished states (Done/Closed/Removed/Completed)' },
    state: { type: 'string', description: 'Exact state filter' },
    type: { type: 'string', description: 'Work item type filter (e.g. Task, Bug)' },
  },
  async run({ args }) {
    const id = parseId(args.id);
    await runService(WorkItemService, args, (svc) =>
      svc.getChildWorkItems({
        id,
        recursive: args.recursive,
        mine: args.mine,
        openOnly: args.open,
        state: args.state,
        type: args.type,
      }),
    );
  },
});

const history = defineCommand({
  meta: { name: 'history', description: 'Get work item history' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
  },
  async run({ args }) {
    const id = parseId(args.id);
    await runService(WorkItemService, args, (svc) => svc.getWorkItemHistory({ id }));
  },
});

const search = defineCommand({
  meta: { name: 'search', description: 'Search work items by text' },
  args: {
    ...globalOptions,
    query: { type: 'positional', description: 'Search text', required: true },
    top: { type: 'string', description: 'Max results' },
  },
  async run({ args }) {
    await runService(WorkItemService, args, (svc) => svc.searchWorkItems({ searchText: args.query!, top: args.top ? Number(args.top) : undefined }));
  },
});

const recent = defineCommand({
  meta: { name: 'recent', description: 'Get recently updated work items' },
  args: {
    ...globalOptions,
    top: { type: 'string', description: 'Max results', default: '10' },
    skip: { type: 'string', description: 'Skip N results', default: '0' },
  },
  async run({ args }) {
    await runService(WorkItemService, args, (svc) => svc.getRecentWorkItems({ top: Number(args.top), skip: Number(args.skip) }));
  },
});

const mine = defineCommand({
  meta: { name: 'mine', description: 'Get work items assigned to me' },
  args: {
    ...globalOptions,
    path: { type: 'string', description: 'Iteration path filter', default: '' },
    state: { type: 'string', description: 'State filter' },
    open: { type: 'boolean', description: 'Exclude finished states (Done/Closed/Removed/Completed)' },
    top: { type: 'string', description: 'Max results', default: '100' },
  },
  async run({ args }) {
    await runService(WorkItemService, args, (svc) => svc.getMyWorkItems({ path: args.path!, state: args.state, openOnly: args.open, top: Number(args.top) }));
  },
});

const create = defineCommand({
  meta: { name: 'create', description: 'Create a work item' },
  args: {
    ...globalOptions,
    type: { type: 'string', description: 'Work item type (e.g. Task, Bug)', required: true },
    title: { type: 'string', description: 'Title', required: true },
    description: { type: 'string', description: 'Description' },
    assignedTo: { type: 'string', description: 'Assign to user' },
    state: { type: 'string', description: 'Initial state' },
    areaPath: { type: 'string', description: 'Area path' },
    iterationPath: { type: 'string', description: 'Iteration path' },
    format: { type: 'string', description: "Format of the rich-text FIELDS being set (description etc.): 'html' or 'markdown'. For the CLI output format use --json/--markdown" },
  },
  async run({ args }) {
    const richTextFormat = parseRichTextFormat(args.format);
    await runService(WorkItemService, args, (svc) =>
      svc.createWorkItem({
        workItemType: args.type!,
        title: args.title!,
        description: args.description,
        assignedTo: args.assignedTo,
        state: args.state,
        areaPath: args.areaPath,
        iterationPath: args.iterationPath,
        format: richTextFormat,
      }),
    );
  },
});

const update = defineCommand({
  meta: { name: 'update', description: 'Update a work item' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    fields: { type: 'string', description: 'JSON object of fields to update', required: true },
    format: { type: 'string', description: "Format of the rich-text FIELDS being updated (description etc.): 'html' or 'markdown'. For the CLI output format use --json/--markdown" },
  },
  async run({ args }) {
    const id = parseId(args.id);
    const richTextFormat = parseRichTextFormat(args.format);
    await runService(WorkItemService, args, (svc) =>
      svc.updateWorkItem({ id, fields: JSON.parse(args.fields!), format: richTextFormat }),
    );
  },
});

const comment = defineCommand({
  meta: { name: 'comment', description: 'Add a comment to a work item' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    text: { type: 'string', description: 'Comment text', required: true },
  },
  async run({ args }) {
    const id = parseId(args.id);
    await runService(WorkItemService, args, (svc) => svc.addWorkItemComment({ id, text: args.text! }));
  },
});

const setState = defineCommand({
  meta: { name: 'set-state', description: 'Update work item state' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    state: { type: 'string', description: 'New state', required: true },
    comment: { type: 'string', description: 'Optional comment' },
  },
  async run({ args }) {
    const id = parseId(args.id);
    await runService(WorkItemService, args, (svc) => svc.updateWorkItemState({ id, state: args.state!, comment: args.comment }));
  },
});

const assign = defineCommand({
  meta: { name: 'assign', description: 'Assign a work item to a user' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    to: { type: 'string', description: 'User to assign to', required: true },
  },
  async run({ args }) {
    const id = parseId(args.id);
    await runService(WorkItemService, args, (svc) => svc.assignWorkItem({ id, assignedTo: args.to! }));
  },
});

const link = defineCommand({
  meta: { name: 'link', description: 'Create a link between work items' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Source work item ID', required: true },
    targetId: { type: 'string', description: 'Target work item ID', required: true },
    linkType: { type: 'string', description: 'Link type (e.g. System.LinkTypes.Dependency-forward)', required: true },
    comment: { type: 'string', description: 'Optional comment' },
  },
  async run({ args }) {
    const sourceId = parseId(args.id, 'source work item ID');
    const targetId = parseId(args.targetId, 'target work item ID');
    await runService(WorkItemService, args, (svc) =>
      svc.createLink({
        sourceId,
        targetId,
        linkType: args.linkType!,
        comment: args.comment,
      }),
    );
  },
});

const bulkCreate = defineCommand({
  meta: { name: 'bulk-create', description: 'Bulk create or update work items' },
  args: {
    ...globalOptions,
    items: { type: 'string', description: 'JSON array of work item create/update params', required: true },
  },
  async run({ args }) {
    await runService(WorkItemService, args, (svc) => svc.bulkUpdateWorkItems({ workItems: JSON.parse(args.items!) }));
  },
});

export default defineCommand({
  meta: { name: 'workitem', description: 'Work item commands' },
  subCommands: {
    list,
    get,
    children,
    history,
    search,
    recent,
    mine,
    create,
    update,
    comment,
    'set-state': setState,
    assign,
    link,
    'bulk-create': bulkCreate,
  },
});
