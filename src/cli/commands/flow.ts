import { defineCommand } from 'citty';
import { FlowService } from '../../services/FlowService';
import { globalOptions, runCommand, runService } from '../command';
import { flowsPath, loadFlows } from '../flows';
import { format } from '../formatters/index';
import { failUsage, parseCsv, parseId, parseOptionalId } from '../parsers';

const parentArg = { type: 'positional' as const, description: 'Story (parent) work item ID', required: false };
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

    await runService(FlowService, args, (svc) =>
      parentId
        ? svc.flowStatus(flows, { parentId, flow: args.flow })
        : svc.sprintFlowStatus(flows, { sprint: args.sprint!, flow: args.flow, mine: args.mine, teamId: args.teamId }),
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
    dryRun: { type: 'boolean', description: 'Show what would be created without creating' },
  },
  async run({ args }) {
    const parentId = parseId(args.id, 'story work item ID');
    const flows = loadFlows();
    await runService(FlowService, args, (svc) =>
      svc.applyFlow(flows, {
        parentId,
        flow: args.flow,
        only: parseCsv(args.only),
        skip: parseCsv(args.skip),
        with: parseCsv(args.with),
        sprint: args.sprint,
        dryRun: args.dryRun,
      }),
    );
  },
});

export default defineCommand({
  meta: { name: 'flow', description: 'Story cycles: create the standard cards of a story and audit them (flows.json)' },
  subCommands: { list, status, apply },
});
