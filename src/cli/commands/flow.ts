import { defineCommand } from 'citty';
import { FlowService } from '../../services/FlowService';
import { globalOptions, runCommand, runService } from '../command';
import { flowsPath, loadFlows } from '../flows';
import { format } from '../formatters/index';
import { failUsage, parseCsv, parseId, parseJsonObject, parseOptionalId } from '../parsers';
import { loadTemplates, readCardDescriptions } from '../templates';
import { updateWatch } from '../watchState';
import { addWatch } from '../../services/watch';

const parentArg = { type: 'positional' as const, description: 'Story (parent) work item ID', required: false };

function parseTitles(value: string): Record<string, string> {
  const titles = parseJsonObject(value, '--titles');
  const notText = Object.keys(titles).filter(key => typeof titles[key] !== 'string');
  if (notText.length) failUsage(`--titles values must be strings: ${notText.join(', ')}`);
  return titles as Record<string, string>;
}
const flowArg = { type: 'string' as const, description: "Flow name (default: the one whose parentTypes include the story's type)" };

const list = defineCommand({
  meta: { name: 'list', description: 'List the flows defined in flows.json (next to config.json)' },
  args: { json: globalOptions.json, markdown: globalOptions.markdown },
  async run({ args }) {
    await runCommand(async () => {
      console.log(format({ file: flowsPath(), flows: FlowService.describe(loadFlows()) }, args));
    });
  },
});

const status = defineCommand({
  meta: {
    name: 'status',
    description: "Audit a story's cycle against its flow: missing cards, empty tests, tests older than a fix, misnamed publications. --sprint audits every story of a sprint",
  },
  args: {
    ...globalOptions,
    id: parentArg,
    flow: flowArg,
    sprint: { type: 'string', description: "Audit every story of this sprint ('current', 82, Sprint 82)" },
    mine: { type: 'boolean', description: 'With --sprint: only stories holding one of my cards in the sprint' },
    teamId: { type: 'string', description: 'Team ID (optional, for --sprint current)' },
  },
  async run({ args }) {
    const parentId = parseOptionalId(args.id, 'story work item ID');
    if (!parentId && !args.sprint) failUsage('Pass a story ID or --sprint');
    if (parentId && args.sprint) failUsage('Pass a story ID or --sprint, not both');
    const flows = loadFlows();

    const templates = loadTemplates();
    await runService(FlowService, args, (svc) =>
      parentId
        ? svc.flowStatus(flows, { parentId, flow: args.flow }, templates)
        : svc.sprintFlowStatus(flows, { sprint: args.sprint!, flow: args.flow, mine: args.mine, teamId: args.teamId }, templates),
    );
  },
});

const apply = defineCommand({
  meta: {
    name: 'apply',
    description: "Create the flow's cards the story is missing, as its children (idempotent; --dryRun previews)",
  },
  args: {
    ...globalOptions,
    id: { ...parentArg, required: true },
    flow: flowArg,
    only: { type: 'string', description: 'Comma-separated card keys to create (others are skipped)' },
    skip: { type: 'string', description: 'Comma-separated card keys not to create' },
    with: { type: 'string', description: 'Comma-separated optional card keys to create too (left out by default)' },
    sprint: { type: 'string', description: 'Sprint for every created card (default: card setting, else the story\'s)' },
    name: { type: 'string', description: "Feature name for {title} in the cards' titles, instead of the story's title" },
    titles: {
      type: 'string',
      description: 'JSON object of whole titles by card key, e.g. {"pub-prod":"Deploy X [PROD]"} — each must still match its card\'s "match"',
    },
    descriptions: {
      type: 'string',
      description: "Directory with one <key>.md per card to create — each card's own description, written from its template",
    },
    noTemplate: { type: 'boolean', description: 'Skip the template requirement (cards are created without a description)' },
    dryRun: { type: 'boolean', description: 'Show what would be created, and which template each description follows, without creating' },
  },
  async run({ args }) {
    const parentId = parseId(args.id, 'story work item ID');
    const flows = loadFlows();
    const templates = loadTemplates();
    const descriptions = args.descriptions ? readCardDescriptions(args.descriptions) : undefined;
    const titles = args.titles ? parseTitles(args.titles) : undefined;
    if (args.name !== undefined && !args.name.trim()) failUsage('--name is empty');
    await runService(FlowService, args, async (svc) => {
      const result = await svc.applyFlow(flows, {
        parentId,
        flow: args.flow,
        only: parseCsv(args.only),
        skip: parseCsv(args.skip),
        with: parseCsv(args.with),
        sprint: args.sprint,
        name: args.name,
        titles,
        dryRun: args.dryRun,
        descriptions,
        noTemplate: args.noTemplate,
      }, templates);
      if (args.dryRun) return result;
      // The story's cycle cards go to other people; watching it brings their changes to the inbox.
      try {
        updateWatch(svc.project, list => addWatch(list, parentId, new Date()));
        return { ...result, watching: true };
      } catch (err) {
        // The cards exist by now: a broken watch.json must not report the apply as failed.
        console.error(`Warning: story ${parentId} was not added to the watch list: ${(err as Error).message}`);
        return result;
      }
    });
  },
});

export default defineCommand({
  meta: { name: 'flow', description: 'Story cycles: create the standard cards of a story and audit them (flows.json)' },
  subCommands: { list, status, apply },
});
