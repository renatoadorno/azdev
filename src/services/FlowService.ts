import { CommentSortOrder } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import type {
  ApplyFlowParams,
  FlowCard,
  FlowDefinition,
  FlowStatusParams,
  FlowsFile,
  SprintFlowStatusParams,
} from '../interfaces/Flows';
import type { DescriptionTemplate } from '../interfaces/WorkItems';
import { WorkItemService } from './WorkItemService';
import { checkDescription, fillTemplate, findTemplate } from './descriptionTemplates';
import {
  DEFAULT_HYDRATE_FIELDS,
  REMOVED_STATE,
  buildFilterClauses,
  slimWorkItem,
  wiqlEscape,
  type WorkItemRow,
} from './workItemUtils';
import {
  applicableFlows,
  cardFor,
  closedAt,
  evaluateFlow,
  pickFlow,
  planFlow,
  renderTemplate,
  type FlowEvaluation,
} from './flowRules';

const STORY_FIELDS = ['System.Id', 'System.WorkItemType', 'System.State', 'System.Title', 'System.AssignedTo'];

// Description and close dates feed the audit (empty tests card, tests older than a fix).
const AUDIT_FIELDS = [
  ...DEFAULT_HYDRATE_FIELDS,
  'System.Description',
  'Microsoft.VSTS.Common.ClosedDate',
  'Microsoft.VSTS.Common.StateChangeDate',
];

/** Audit-only columns, dropped before printing. */
function display({ Description: _d, ClosedDate: _c, StateChangeDate: _s, Parent: _p, ...row }: WorkItemRow): WorkItemRow {
  return row;
}

function brief(story: WorkItemRow): WorkItemRow {
  return { id: story.id, WorkItemType: story.WorkItemType, State: story.State, Title: story.Title, AssignedTo: story.AssignedTo };
}

export class FlowService extends WorkItemService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  private async story(id: number): Promise<WorkItemRow> {
    const [story] = await this.hydrate([id], STORY_FIELDS);
    if (!story) throw new Error(`Work item ${id} not found`);
    return story;
  }

  /** Newest comment date of the closed cards whose freshness is audited. */
  private async lastComments(flow: FlowDefinition, children: WorkItemRow[]): Promise<Map<number, string | undefined>> {
    const ids = children
      .filter(row => row.State !== REMOVED_STATE && cardFor(flow.cards, row)?.retestAfter?.length && closedAt(row))
      .map(row => row.id!);
    const witApi = await this.getWorkItemTrackingApi();
    const entries = await Promise.all(ids.map(async id => {
      const list = await witApi.getComments(this.config.project, id, 1, undefined, false, undefined, CommentSortOrder.Desc);
      const date = list?.comments?.[0]?.createdDate;
      return [id, date ? new Date(date).toISOString() : undefined] as const;
    }));
    return new Map(entries);
  }

  private async evaluate(
    flow: FlowDefinition,
    children: WorkItemRow[],
    story: WorkItemRow,
    templates: DescriptionTemplate[],
  ): Promise<FlowEvaluation> {
    const ctx = { title: String(story.Title), id: story.id! };
    const evaluation = evaluateFlow(flow, children, await this.lastComments(flow, children), ctx, templates);
    return { ...evaluation, others: evaluation.others.map(display) };
  }

  /** The story's cycle against its flow: which cards exist, which are missing, and what is off. */
  public async flowStatus(
    file: FlowsFile,
    params: FlowStatusParams,
    templates: DescriptionTemplate[] = [],
  ): Promise<Record<string, unknown>> {
    const story = await this.story(params.parentId);
    const [name, flow] = pickFlow(file, String(story.WorkItemType), params.flow);
    const children = (await this.childrenOf([params.parentId], AUDIT_FIELDS)).get(params.parentId) ?? [];
    return { story: brief(story), flow: name, ...(await this.evaluate(flow, children, story, templates)) };
  }

  /**
   * Audit of every story in a sprint that has a flow — catch a missing card
   * before someone else does. With `mine`, only stories holding one of my cards.
   */
  public async sprintFlowStatus(
    file: FlowsFile,
    params: SprintFlowStatusParams,
    templates: DescriptionTemplate[] = [],
  ): Promise<Record<string, unknown>> {
    const iteration = await this.resolveIteration(params.sprint, params.teamId);
    const inSprint = `[System.IterationPath] = '${wiqlEscape(iteration.path!)}'`;

    let storyIds: number[];
    if (params.mine) {
      const mine = await this.hydrate(
        await this.queryIds(`SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ${inSprint} AND ${buildFilterClauses({ mine: true }).join(' AND ')}`),
        ['System.Id', 'System.Parent'],
      );
      storyIds = [...new Set(mine.map(r => r.Parent).filter((id): id is number => typeof id === 'number'))];
    } else {
      const flows = params.flow ? [pickFlow(file, '', params.flow)[1]] : Object.values(file.flows);
      const parentTypes = [...new Set(flows.flatMap(f => f.parentTypes ?? []))];
      if (parentTypes.length === 0) {
        throw new Error('No flow declares "parentTypes", so stories cannot be found by sprint — use --mine');
      }
      storyIds = await this.queryIds(
        `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ${inSprint} AND [System.WorkItemType] IN (${parentTypes.map(t => `'${wiqlEscape(t)}'`).join(', ')}) ORDER BY [System.Id]`,
      );
    }

    const stories = await this.hydrate(storyIds, STORY_FIELDS);
    const childrenByStory = await this.childrenOf(storyIds, AUDIT_FIELDS);
    const rows: WorkItemRow[] = [];
    const findings: Array<{ story: number; finding: string }> = [];

    for (const story of stories) {
      const type = String(story.WorkItemType);
      // A parent no flow applies to (Epic, Feature…) is not audited; several flows applying is an error.
      if (!params.flow && applicableFlows(file, type).length === 0) continue;
      const [name, flow] = pickFlow(file, type, params.flow);
      const evaluation = await this.evaluate(flow, childrenByStory.get(story.id!) ?? [], story, templates);
      const missing = evaluation.cards.filter(c => c.status === 'missing').map(c => c.key);
      rows.push({
        ...brief(story),
        flow: name,
        missing: missing.join(','),
        findings: evaluation.findings.length,
      });
      for (const finding of evaluation.findings) findings.push({ story: story.id!, finding });
    }

    return { sprint: iteration.name, stories: rows, findings };
  }

  /**
   * Creates the cards of the flow the story does not have yet. Idempotent: an
   * existing card (matched by type and title pattern) is never created twice.
   */
  public async applyFlow(
    file: FlowsFile,
    params: ApplyFlowParams,
    templates: DescriptionTemplate[] = [],
  ): Promise<Record<string, unknown>> {
    const story = await this.story(params.parentId);
    const [name, flow] = pickFlow(file, String(story.WorkItemType), params.flow);
    const children = (await this.childrenOf([params.parentId], AUDIT_FIELDS)).get(params.parentId) ?? [];
    const storyTitle = String(story.Title);
    // A feature often spans repositories under a story whose title is not the feature's name.
    const ctx = { title: params.name?.trim() || storyTitle, id: params.parentId };
    const plan = planFlow(flow, children, ctx, params);
    const descriptions = params.descriptions ?? {};

    const unknownKeys = Object.keys(descriptions).filter(key => !flow.cards.some(card => card.key === key));
    if (unknownKeys.length) {
      throw new Error(`Descriptions for unknown card key(s): ${unknownKeys.join(', ')}. Cards: ${flow.cards.map(c => c.key).join(', ')}`);
    }

    // The model each card's description is written from: its inline description, else its template file.
    const modelFor = (card: FlowCard): DescriptionTemplate | undefined => {
      if (params.noTemplate) return undefined;
      if (card.description) return { name: `${card.key} (flows.json)`, content: renderTemplate(card.description, ctx) };
      return findTemplate(templates, card.template ?? card.type);
    };
    const toCreate = plan.filter(p => p.action === 'create');
    const missingTemplates = toCreate.filter(p => !params.noTemplate && p.card.template && !findTemplate(templates, p.card.template));
    if (missingTemplates.length) {
      throw new Error(`Template(s) not found in templates/: ${missingTemplates.map(p => `${p.card.key} → ${p.card.template}`).join(', ')}`);
    }
    // Checked before the first create, so a bad description never leaves the story half-built.
    if (!params.dryRun) {
      const undescribed = toCreate.filter(p => modelFor(p.card) && descriptions[p.card.key] === undefined);
      if (undescribed.length) {
        const list = undescribed.map(p => `${p.card.key} (${modelFor(p.card)!.name})`).join(', ');
        throw new Error(
          `Write each card's description from its template and pass them with --descriptions <dir> (<key>.md): ${list}. Read a template with 'azdev workitem template <name>'.`,
        );
      }
      const invalid = toCreate.flatMap(p => {
        const model = modelFor(p.card);
        if (!model) return [];
        const filled = fillTemplate(model.content, { title: p.title, parentId: params.parentId, parentTitle: storyTitle });
        const { error } = checkDescription(descriptions[p.card.key], filled, model.name);
        return error ? [`${p.card.key}: ${error}`] : [];
      });
      if (invalid.length) throw new Error(`Nothing was created. ${invalid.join(' ')}`);
    }

    const results: WorkItemRow[] = [];
    const created: string[] = [];
    // A title given for a card that is not being created is not applied — say so rather than drop it.
    const unusedTitles = Object.keys(params.titles ?? {}).filter(key => !toCreate.some(p => p.card.key === key));
    const warnings: string[] = unusedTitles.length
      ? [`--titles not applied to cards that are not being created: ${unusedTitles.join(', ')}`]
      : [];
    const conflicts = plan.filter(p => p.action === 'conflict').map(p => `${p.card.key}: ${p.reason}`);
    // Same columns on every row, so the plan prints as one table.
    const row = (key: string, action: string, fields: { ids?: string; type: string; title: string; assignedTo?: unknown; state?: unknown; iterationPath?: unknown; template?: string; description?: string }) => ({
      key,
      action,
      ids: fields.ids ?? '',
      type: fields.type,
      title: fields.title,
      assignedTo: fields.assignedTo ?? '',
      state: fields.state ?? '',
      sprint: String(fields.iterationPath ?? '').split('\\').pop() ?? '',
      template: fields.template ?? '',
      description: fields.description ?? '',
    });

    for (const item of plan) {
      const { card } = item;
      if (item.action !== 'create') {
        results.push(row(card.key, item.action, { ids: item.ids, type: card.type, title: item.title }));
        continue;
      }

      const model = modelFor(card);
      const description = descriptions[card.key];
      const request = {
        workItemType: card.type,
        title: item.title,
        description,
        descriptionModel: model,
        assignedTo: card.assignedTo,
        state: card.state,
        sprint: params.sprint ?? card.sprint,
        tags: card.tags,
        parentId: params.parentId,
        // Flow descriptions are written in Markdown, whatever the configured default.
        format: 'markdown' as const,
      };
      const descriptionState = description !== undefined ? 'provided' : model ? 'missing' : '';

      if (params.dryRun) {
        // A missing description is reported in the plan; the request is still resolved to show sprint and assignee.
        const preview = description === undefined ? { ...request, descriptionModel: undefined } : request;
        let state = descriptionState;
        let operations: { path?: string; value?: unknown }[] = [];
        try {
          const built = await this.buildCreateRequest(preview);
          operations = built.operations;
          warnings.push(...built.warnings.map(w => `${card.key}: ${w}`));
        } catch (err) {
          state = 'invalid';
          warnings.push(`${card.key}: ${(err as Error).message}`);
          operations = (await this.buildCreateRequest({ ...preview, descriptionModel: undefined })).operations;
        }
        const value = (ref: string) => operations.find(op => op.path === `/fields/${ref}`)?.value;
        results.push(row(card.key, 'would-create', {
          type: card.type,
          title: item.title,
          assignedTo: value('System.AssignedTo'),
          state: value('System.State'),
          iterationPath: value('System.IterationPath'),
          template: model?.name,
          description: state,
        }));
        continue;
      }

      try {
        const workItem = await this.createWorkItem(request);
        created.push(`${card.key}=#${workItem.id}`);
        const fields = slimWorkItem(workItem, ['WorkItemType', 'State', 'Title', 'AssignedTo', 'IterationPath']);
        results.push(row(card.key, 'created', {
          ids: String(workItem.id),
          type: card.type,
          title: String(fields.Title),
          assignedTo: fields.AssignedTo,
          state: fields.State,
          iterationPath: fields.IterationPath,
          template: model?.name,
          description: descriptionState,
        }));
      } catch (err) {
        const done = created.length ? ` Created so far: ${created.join(', ')}.` : '';
        throw Object.assign(
          new Error(`Failed creating card "${card.key}" (${card.type}): ${(err as Error).message}.${done} Re-run to finish — existing cards are skipped.`),
          { statusCode: (err as { statusCode?: number }).statusCode },
        );
      }
    }

    return {
      story: brief(story),
      flow: name,
      ...(ctx.title !== storyTitle ? { name: ctx.title } : {}),
      dryRun: params.dryRun || undefined,
      cards: results,
      ...(conflicts.length ? { conflicts } : {}),
      ...(warnings.length ? { warnings } : {}),
    };
  }

  /** The defined flows, compact. */
  public static describe(file: FlowsFile): WorkItemRow[] {
    return Object.entries(file.flows).map(([name, flow]) => ({
      name,
      description: flow.description,
      parentTypes: (flow.parentTypes ?? []).join(', ') || undefined,
      cards: flow.cards.map(c => `${c.key}: ${c.type}${c.optional ? ' (optional)' : ''}`).join('; '),
    }));
  }
}
