import * as fs from 'fs';
import * as path from 'path';
import { defineCommand } from 'citty';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { WorkItemService } from '../../services/WorkItemService';
import { WorkItemViewService } from '../../services/WorkItemViewService';
import { StatsService } from '../../services/StatsService';
import { DEFAULT_HISTORY_FIELDS, revisionTimeline } from '../../services/history';
import { attachmentFileName } from '../../services/richText';
import { slimWorkItem } from '../../services/workItemUtils';
import { globalOptions, runCommand, runService } from '../command';
import { format } from '../formatters/index';
import { chooseTemplate, loadTemplates, requireTemplate } from '../templates';
import { fillTemplate, headings, needsParentTitle } from '../../services/descriptionTemplates';
import {
  failUsage,
  parseCount,
  parseCsv,
  parseId,
  parseJsonObject,
  parseOptionalId,
  parseRichTextFormat,
  textOrFile,
} from '../parsers';

const rawWrite = { type: 'boolean' as const, description: 'Return the full work item instead of the compact confirmation' };
const formatArg = {
  type: 'string' as const,
  description: "Format of the rich-text FIELDS written: 'html' or 'markdown' (default: config richTextFormat, else html). For the CLI output format use --json/--markdown",
};
const sprintArg = { type: 'string' as const, description: "Sprint: 'current', a number (82), a name (Sprint 82) or a path" };

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

const query = defineCommand({
  meta: {
    name: 'query',
    description: 'Free query: filter flags and/or a WIQL condition (--where) or a whole WIQL query (--wiql); rows, --count or --groupBy',
  },
  args: {
    ...globalOptions,
    type: { type: 'string', description: 'Work item type(s), comma-separated' },
    state: { type: 'string', description: 'State(s), comma-separated' },
    open: { type: 'boolean', description: 'Exclude finished states (Done/Closed/Removed/Completed)' },
    mine: { type: 'boolean', description: 'Only items assigned to me' },
    assignedTo: { type: 'string', description: "Only items assigned to this user (e-mail or name; '@me' = you)" },
    unassigned: { type: 'boolean', description: 'Only items with no assignee' },
    sprint: sprintArg,
    area: { type: 'string', description: 'Area path (subareas included)' },
    tags: { type: 'string', description: 'Items carrying every one of these tags, comma-separated' },
    text: { type: 'string', description: 'Text in the title or the description' },
    parent: { type: 'string', description: 'Only children of this work item' },
    createdSince: { type: 'string', description: 'Created on or after: 7d, 2w, 3m, 1y, today, yesterday or YYYY-MM-DD' },
    changedSince: { type: 'string', description: 'Changed on or after (same forms)' },
    closedSince: { type: 'string', description: 'Closed on or after (same forms)' },
    where: { type: 'string', description: "Extra WIQL condition; short names in brackets are resolved, e.g. \"[priority] = 1 AND [title] CONTAINS 'PROD'\"" },
    wiql: { type: 'string', description: 'A whole WIQL query, run as given (no filter flags)' },
    wiqlFile: { type: 'string', description: "Read the whole WIQL query from a file ('-' = stdin)" },
    fields: { type: 'string', description: 'Columns to return, comma-separated (short, display or reference names)' },
    orderBy: { type: 'string', description: "Order, e.g. 'changed desc' or 'priority, id' (default: changed desc)" },
    top: { type: 'string', description: 'Max rows (0 = no limit)', default: '100' },
    count: { type: 'boolean', description: 'Only how many items match' },
    groupBy: { type: 'string', description: 'Count the matches by these fields, comma-separated (e.g. state,assignedTo)' },
    printWiql: { type: 'boolean', description: 'Print the WIQL the flags build, without running it' },
  },
  async run({ args }) {
    const wiql = textOrFile(args.wiql, args.wiqlFile, ['wiql', 'wiqlFile']);
    const filterFlags = ['type', 'state', 'open', 'mine', 'assignedTo', 'unassigned', 'sprint', 'area', 'tags', 'text', 'parent', 'createdSince', 'changedSince', 'closedSince', 'where', 'orderBy'] as const;
    const used = filterFlags.filter(flag => args[flag] !== undefined && args[flag] !== false);
    if (wiql !== undefined && used.length) failUsage(`--wiql runs as given: drop ${used.map(f => `--${f}`).join(', ')} or write them into the query`);
    if (wiql !== undefined && !/^\s*select\b/i.test(wiql)) failUsage('--wiql must be a whole query starting with SELECT (use --where for a condition)');
    if (args.count && args.groupBy) failUsage('Pass --count or --groupBy, not both');
    if (args.mine && args.assignedTo) failUsage('Pass --mine or --assignedTo, not both');
    if (args.unassigned && (args.mine || args.assignedTo)) failUsage('--unassigned excludes --mine and --assignedTo');
    const top = parseCount(args.top, '--top');
    const parentId = parseOptionalId(args.parent, 'parent work item ID');

    await runService(WorkItemService, args, (svc) =>
      svc.queryWorkItems({
        types: parseCsv(args.type),
        states: parseCsv(args.state),
        openOnly: args.open,
        mine: args.mine,
        assignedTo: args.assignedTo,
        unassigned: args.unassigned,
        sprint: args.sprint,
        area: args.area,
        tags: parseCsv(args.tags),
        text: args.text,
        parentId,
        createdSince: args.createdSince,
        changedSince: args.changedSince,
        closedSince: args.closedSince,
        where: args.where,
        wiql,
        fields: parseCsv(args.fields),
        orderBy: args.orderBy,
        top,
        count: args.count,
        groupBy: parseCsv(args.groupBy),
        printWiql: args.printWiql,
      }),
    );
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

const view = defineCommand({
  meta: {
    name: 'view',
    description: 'Everything about a work item in one call: fields, description as text, parent, children, links, comments, images',
  },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    comments: { type: 'string', description: 'How many of the latest comments to include (0 = none)', default: '5' },
  },
  async run({ args }) {
    const id = parseId(args.id);
    const comments = parseCount(args.comments, '--comments');
    await runService(WorkItemViewService, args, (svc) => svc.viewWorkItem({ id, comments }));
  },
});

const comments = defineCommand({
  meta: { name: 'comments', description: 'Read the comments of a work item (oldest first, as plain text)' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    top: { type: 'string', description: 'How many of the latest comments to return', default: '20' },
    raw: { type: 'boolean', description: 'Keep the stored HTML/Markdown instead of plain text' },
  },
  async run({ args }) {
    const id = parseId(args.id);
    const top = parseCount(args.top, '--top');
    await runService(WorkItemService, args, (svc) => svc.getComments({ id, top, raw: args.raw }));
  },
});

const attachments = defineCommand({
  meta: {
    name: 'attachments',
    description: 'List the attachments of a work item (attached files and images inline in description/comments); --download saves them',
  },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    download: { type: 'string', description: 'Directory to save every attachment into (uses the configured credential)' },
  },
  async run({ args }) {
    const id = parseId(args.id);
    await runService(WorkItemViewService, args, async (svc) => {
      const entries = await svc.listAttachments({ id });
      if (!args.download) return entries.map(({ name, source, url }) => ({ name, source, url }));

      fs.mkdirSync(args.download, { recursive: true });
      const saved = [];
      for (const entry of entries) {
        const bytes = await svc.downloadAttachment(entry);
        const file = path.resolve(args.download, attachmentFileName(entry));
        fs.writeFileSync(file, bytes);
        saved.push({ name: entry.name, source: entry.source, path: file, bytes: bytes.length });
      }
      return saved;
    });
  },
});

const template = defineCommand({
  meta: {
    name: 'template',
    description: "Show a description template — the model to write a card's own description from; without a name, list them",
  },
  args: {
    ...globalOptions,
    name: { type: 'positional', description: 'Template name (a work item type, e.g. Publication)', required: false },
    title: { type: 'string', description: 'Fill {title} with the title of the card being written' },
    parent: { type: 'string', description: 'Fill {parentId} and {parentTitle} from this parent work item' },
  },
  async run({ args }) {
    const templates = loadTemplates();
    if (!args.name) {
      await runCommand(async () => {
        console.log(format(templates.map(t => ({ name: t.name, sections: headings(t.content).join(' | ') })), args));
      });
      return;
    }

    const chosen = requireTemplate(templates, args.name);
    const parentId = parseOptionalId(args.parent, 'parent work item ID');
    if (parentId && needsParentTitle(chosen.content)) {
      await runService(WorkItemService, args, async (svc) => {
        const parent = await svc.getWorkItemById({ id: parentId, fields: ['System.Title'] });
        return fillTemplate(chosen.content, { title: args.title, parentId, parentTitle: parent.fields?.['System.Title'] }, true);
      }, { plainText: true });
      return;
    }
    console.log(fillTemplate(chosen.content, { title: args.title, parentId }, true));
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

const progress = defineCommand({
  meta: {
    name: 'progress',
    description: "How far a story is: its whole subtree done/doing/to do by type and assignee, sprints it spans, what is still open and for how long",
  },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Story (parent) work item ID', required: true },
  },
  async run({ args }) {
    const id = parseId(args.id);
    await runService(StatsService, args, (svc) => svc.storyProgress({ id }));
  },
});

const history = defineCommand({
  meta: { name: 'history', description: 'Timeline of a work item: who changed which field (old → new) and when, plus comments' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    fields: { type: 'string', description: 'Comma-separated fields to follow (short or full names; default: state, owner, sprint, dates, description…)' },
    allFields: { type: 'boolean', description: 'Follow every field' },
    maxText: { type: 'string', description: 'Truncate long values to N characters (0 = no limit)', default: '240' },
    raw: { type: 'boolean', description: 'Return the raw revisions (one full snapshot per revision)' },
  },
  async run({ args }) {
    const id = parseId(args.id);
    const maxText = parseCount(args.maxText, '--maxText');
    const fields = args.allFields ? undefined : parseCsv(args.fields) ?? DEFAULT_HISTORY_FIELDS;
    await runService(WorkItemService, args, async (svc) => {
      const revisions = await svc.getWorkItemHistory({ id });
      return args.raw ? revisions : revisionTimeline(revisions, fields, maxText);
    });
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
    sprint: sprintArg,
    path: { type: 'string', description: 'Iteration path filter (prefer --sprint)' },
    state: { type: 'string', description: 'State filter' },
    open: { type: 'boolean', description: 'Exclude finished states (Done/Closed/Removed/Completed)' },
    top: { type: 'string', description: 'Max results', default: '100' },
  },
  async run({ args }) {
    if (args.sprint && args.path) failUsage('Pass --sprint or --path, not both');
    await runService(WorkItemService, args, (svc) =>
      svc.getMyWorkItems({ sprint: args.sprint, path: args.path, state: args.state, openOnly: args.open, top: Number(args.top) }),
    );
  },
});

const create = defineCommand({
  meta: { name: 'create', description: 'Create a work item — parent, tags and sprint in one call' },
  args: {
    ...globalOptions,
    type: { type: 'string', description: 'Work item type (e.g. Task, Bug)', required: true },
    title: { type: 'string', description: 'Title', required: true },
    parent: { type: 'string', description: 'Parent work item ID; area and sprint are inherited from it unless given' },
    tags: { type: 'string', description: "Tags separated by ';' or ','" },
    sprint: sprintArg,
    description: { type: 'string', description: 'Description' },
    descriptionFile: { type: 'string', description: "Read the description from a file ('-' = stdin)" },
    template: { type: 'string', description: 'Template the description is written from (default: templates/<type>.md, if it exists); the description is required and checked against it' },
    noTemplate: { type: 'boolean', description: 'Skip the template check (allows creating without a description)' },
    assignedTo: { type: 'string', description: "Assign to user (e-mail or name; '@me' = you)" },
    state: { type: 'string', description: 'Initial state' },
    areaPath: { type: 'string', description: 'Area path' },
    iterationPath: { type: 'string', description: 'Iteration path (prefer --sprint)' },
    format: formatArg,
    dryRun: { type: 'boolean', description: 'Print the resolved request instead of creating' },
    raw: rawWrite,
  },
  async run({ args }) {
    const richTextFormat = parseRichTextFormat(args.format);
    const parentId = parseOptionalId(args.parent, 'parent work item ID');
    const description = textOrFile(args.description, args.descriptionFile, ['description', 'descriptionFile']);
    if (args.sprint && args.iterationPath) failUsage('Pass --sprint or --iterationPath, not both');
    const template = chooseTemplate(loadTemplates(), args.type!, { template: args.template, noTemplate: args.noTemplate });

    const params = {
      workItemType: args.type!,
      title: args.title!,
      description,
      descriptionModel: template,
      assignedTo: args.assignedTo,
      state: args.state,
      areaPath: args.areaPath,
      iterationPath: args.iterationPath,
      sprint: args.sprint,
      parentId,
      tags: args.tags,
      format: richTextFormat,
    };
    const used = template ? { template: template.name } : {};
    await runService(WorkItemService, args, async (svc) => {
      if (args.dryRun) {
        const request = await svc.buildCreateRequest(params);
        const operations = request.operations.map(op => ({ ...op, op: Operation[op.op].toLowerCase() }));
        const warnings = request.warnings.length ? { warnings: request.warnings } : {};
        return { dryRun: true, ...used, ...warnings, workItemType: request.workItemType, operations };
      }
      const created = await svc.createWorkItem(params);
      return args.raw ? created : { ...svc.summarize(created), ...used };
    });
  },
});

const update = defineCommand({
  meta: { name: 'update', description: 'Update a work item' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    fields: { type: 'string', description: 'JSON object of fields to update (reference names)' },
    title: { type: 'string', description: 'New title' },
    descriptionFile: { type: 'string', description: "Replace the description with a file's contents ('-' = stdin)" },
    sprint: sprintArg,
    format: formatArg,
    raw: rawWrite,
  },
  async run({ args }) {
    const id = parseId(args.id);
    const richTextFormat = parseRichTextFormat(args.format);
    const fields: Record<string, unknown> = args.fields ? parseJsonObject(args.fields, '--fields') : {};
    if (args.title !== undefined) fields['System.Title'] = args.title;
    const description = textOrFile(undefined, args.descriptionFile, ['description', 'descriptionFile']);
    if (description !== undefined) fields['System.Description'] = description;
    if (Object.keys(fields).length === 0 && !args.sprint) {
      failUsage('Nothing to update: pass --fields, --title, --descriptionFile or --sprint');
    }

    await runService(WorkItemService, args, async (svc) => {
      const updated = await svc.updateWorkItem({ id, fields, sprint: args.sprint, format: richTextFormat });
      return args.raw ? updated : svc.summarize(updated);
    });
  },
});

const comment = defineCommand({
  meta: { name: 'comment', description: 'Add a comment to a work item' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    text: { type: 'string', description: 'Comment text' },
    file: { type: 'string', description: "Read the comment from a file ('-' = stdin)" },
    format: {
      type: 'string',
      description: "'markdown' keeps line breaks and #id links; 'html' is the API default (default: config richTextFormat)",
    },
    raw: { type: 'boolean', description: 'Return the full comment object' },
  },
  async run({ args }) {
    const id = parseId(args.id);
    const richTextFormat = parseRichTextFormat(args.format);
    const text = textOrFile(args.text, args.file, ['text', 'file']);
    if (!text?.trim()) failUsage('Pass the comment with --text or --file');

    await runService(WorkItemService, args, async (svc) => {
      const created = await svc.addWorkItemComment({ id, text, format: richTextFormat });
      return args.raw ? created : svc.slimComment(created, true);
    });
  },
});

const setState = defineCommand({
  meta: { name: 'set-state', description: 'Update work item state (an invalid state lists the valid ones for the type)' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    state: { type: 'string', description: 'New state', required: true },
    comment: { type: 'string', description: 'Optional comment' },
    raw: rawWrite,
  },
  async run({ args }) {
    const id = parseId(args.id);
    await runService(WorkItemService, args, async (svc) => {
      const updated = await svc.updateWorkItemState({ id, state: args.state!, comment: args.comment });
      return args.raw ? updated : svc.summarize(updated);
    });
  },
});

const assign = defineCommand({
  meta: { name: 'assign', description: 'Assign a work item to a user' },
  args: {
    ...globalOptions,
    id: { type: 'positional', description: 'Work item ID', required: true },
    to: { type: 'string', description: "User to assign to (e-mail or name; '@me' = you)", required: true },
    raw: rawWrite,
  },
  async run({ args }) {
    const id = parseId(args.id);
    await runService(WorkItemService, args, async (svc) => {
      const updated = await svc.assignWorkItem({ id, assignedTo: args.to! });
      return args.raw ? updated : svc.summarize(updated);
    });
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
    raw: rawWrite,
  },
  async run({ args }) {
    const sourceId = parseId(args.id, 'source work item ID');
    const targetId = parseId(args.targetId, 'target work item ID');
    await runService(WorkItemService, args, async (svc) => {
      const updated = await svc.createLink({ sourceId, targetId, linkType: args.linkType!, comment: args.comment });
      return args.raw ? updated : { ...svc.summarize(updated), linked: targetId, linkType: args.linkType };
    });
  },
});

const bulkCreate = defineCommand({
  meta: { name: 'bulk-create', description: 'Bulk create or update work items' },
  args: {
    ...globalOptions,
    items: { type: 'string', description: 'JSON array of work item create/update params (create accepts parentId, tags, sprint)', required: true },
    raw: rawWrite,
  },
  async run({ args }) {
    let items: unknown;
    try {
      items = JSON.parse(args.items!);
    } catch (err) {
      failUsage(`--items is not valid JSON: ${(err as Error).message}`);
    }
    if (!Array.isArray(items)) failUsage('--items must be a JSON array');

    // Creates are checked against their type's template, like `create`.
    const templates = loadTemplates();
    const workItems = (items as any[]).map(item => {
      if ('id' in item) return item;
      const { template: name, noTemplate, ...rest } = item;
      const template = chooseTemplate(templates, String(item.workItemType ?? ''), { template: name, noTemplate });
      return template ? { ...rest, descriptionModel: template } : rest;
    });

    await runService(WorkItemService, args, async (svc) => {
      const results = await svc.bulkUpdateWorkItems({ workItems });
      return args.raw ? { count: results.length, workItems: results } : results.map(wi => svc.summarize(wi));
    });
  },
});

export default defineCommand({
  meta: { name: 'workitem', description: 'Work item commands' },
  subCommands: {
    list,
    query,
    get,
    view,
    comments,
    attachments,
    template,
    children,
    progress,
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
