import { defineCommand } from 'citty';
import { WorkItemService } from '../../services/WorkItemService';
import { slimWorkItem } from '../../services/workItemUtils';
import { loadCliConfig } from '../config';
import { exitWithError } from '../errors';
import { format } from '../formatters/index';
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

const globalOptions = {
  json: { type: 'boolean' as const, description: 'Output as JSON' },
  markdown: { type: 'boolean' as const, description: 'Output as Markdown' },
  project: { type: 'string' as const, description: 'Override project from config' },
};

function getService(options: { project?: string }) {
  const config = loadCliConfig();
  if (options.project) config.project = options.project;
  return new WorkItemService(config);
}

const list = defineCommand({
  meta: { name: 'list', description: 'List work items via WIQL query' },
  args: {
    ...globalOptions,
    query: { type: 'string', description: 'WIQL query string', default: "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.CreatedDate] DESC" },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.listWorkItems(args.query!);
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const fields = parseCsv(args.fields);
      const result = await svc.getWorkItemById({ id, fields });
      const view = args.raw ? result : slimWorkItem(result, fields);
      console.log(format(view, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.getChildWorkItems({
        id,
        recursive: args.recursive,
        mine: args.mine,
        openOnly: args.open,
        state: args.state,
        type: args.type,
      });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.getWorkItemHistory({ id });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.searchWorkItems({ searchText: args.query!, top: args.top ? Number(args.top) : undefined });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.getRecentWorkItems({ top: Number(args.top), skip: Number(args.skip) });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.getMyWorkItems({ path: args.path!, state: args.state, openOnly: args.open, top: Number(args.top) });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.createWorkItem({
        workItemType: args.type!,
        title: args.title!,
        description: args.description,
        assignedTo: args.assignedTo,
        state: args.state,
        areaPath: args.areaPath,
        iterationPath: args.iterationPath,
        format: richTextFormat,
      });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const fields = JSON.parse(args.fields!);
      const result = await svc.updateWorkItem({ id, fields, format: richTextFormat });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.addWorkItemComment({ id, text: args.text! });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.updateWorkItemState({ id, state: args.state!, comment: args.comment });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.assignWorkItem({ id, assignedTo: args.to! });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
    try {
      const svc = getService(args);
      const result = await svc.createLink({
        sourceId,
        targetId,
        linkType: args.linkType!,
        comment: args.comment,
      });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
  },
});

const bulkCreate = defineCommand({
  meta: { name: 'bulk-create', description: 'Bulk create or update work items' },
  args: {
    ...globalOptions,
    items: { type: 'string', description: 'JSON array of work item create/update params', required: true },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const workItems = JSON.parse(args.items!);
      const result = await svc.bulkUpdateWorkItems({ workItems });
      console.log(format(result, args));
    } catch (err) {
      exitWithError(err);
    }
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
