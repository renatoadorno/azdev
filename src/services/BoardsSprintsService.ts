import type { CoreApi } from 'azure-devops-node-api/CoreApi';
import type { TeamContext } from 'azure-devops-node-api/interfaces/CoreInterfaces';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type { JsonPatchOperation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import { AzureDevOpsService } from './AzureDevOpsService';
import { groupDelivery } from './sprintSummary';
import {
  DEFAULT_HYDRATE_FIELDS,
  REMOVED_STATE,
  buildFilterClauses,
  slimWorkItem,
  wiqlEscape,
} from './workItemUtils';
import type {
  GetBoardsParams,
  GetBoardColumnsParams,
  GetBoardItemsParams,
  MoveCardOnBoardParams,
  GetSprintsParams,
  GetCurrentSprintParams,
  GetSprintWorkItemsParams,
  GetSprintCapacityParams,
  GetTeamMembersParams,
  SprintSummaryParams,
} from '../interfaces/BoardsAndSprints';

const DEFAULT_SPRINT = 'current';

const BOARD_ITEMS_TOP = 200;
const BOARD_ITEM_FIELDS = [
  'System.Id',
  'System.Title',
  'System.State',
  'System.WorkItemType',
  'System.AssignedTo',
];

export class BoardsSprintsService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  private async getCoreApi(): Promise<CoreApi> {
    return await this.connection.getCoreApi();
  }

  private getTeamContext(teamId?: string): TeamContext {
    return {
      project: this.config.project,
      team: teamId
    };
  }

  private async getDefaultTeamId(): Promise<string> {
    const coreApi = await this.getCoreApi();
    const project = await coreApi.getProject(this.config.project);
    const teamId = project.defaultTeam?.id;
    if (!teamId) throw new Error(`Default team not found for project "${this.config.project}"`);
    return teamId;
  }

  public async getBoards(params: GetBoardsParams): Promise<any> {
    const workApi = await this.getWorkApi();
    const teamContext = this.getTeamContext(params.teamId);
    return await workApi.getBoards(teamContext);
  }

  public async getBoardColumns(params: GetBoardColumnsParams): Promise<any> {
    const workApi = await this.getWorkApi();
    const teamContext = this.getTeamContext(params.teamId);
    return await workApi.getBoardColumns(teamContext, params.boardId);
  }

  public async getBoardItems(params: GetBoardItemsParams): Promise<any> {
    const workApi = await this.getWorkApi();
    const teamContext = this.getTeamContext(params.teamId);

    const board = await workApi.getBoard(teamContext, params.boardId);
    const teamFieldValues = await workApi.getTeamFieldValues(teamContext);
    const areaClauses = (teamFieldValues.values ?? [])
      .filter(v => v.value)
      .map(v => `[System.AreaPath] ${v.includeChildren ? 'UNDER' : '='} '${wiqlEscape(v.value!)}'`)
      .join(' OR ');
    if (!areaClauses) return [];

    const boardTypes = new Set<string>();
    for (const column of board.columns ?? []) {
      for (const type of Object.keys(column.stateMappings ?? {})) boardTypes.add(type);
    }
    const typeClause = boardTypes.size > 0
      ? ` AND [System.WorkItemType] IN (${[...boardTypes].map(t => `'${wiqlEscape(t)}'`).join(', ')})`
      : '';

    const wiql = {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND (${areaClauses})${typeClause} ORDER BY [System.Id]`,
    };

    const witApi = await this.getWorkItemTrackingApi();
    const queryResult = await witApi.queryByWiql(wiql, teamContext, undefined, BOARD_ITEMS_TOP);
    const ids = (queryResult.workItems ?? [])
      .map(item => item.id)
      .filter((id): id is number => id !== undefined);
    if (ids.length === 0) return [];
    if (ids.length >= BOARD_ITEMS_TOP) {
      console.error(`Warning: results capped at ${BOARD_ITEMS_TOP} work items; some board cards may be missing.`);
    }

    const fields = [...BOARD_ITEM_FIELDS];
    const columnField = board.fields?.columnField?.referenceName;
    if (columnField) fields.push(columnField);

    const workItems = await witApi.getWorkItems(
      ids,
      fields,
      undefined,
      undefined,
      undefined,
      this.config.project
    );
    const cards = columnField
      ? (workItems ?? []).filter(item => item.fields?.[columnField] != null)
      : (workItems ?? []);
    return cards.map(item => slimWorkItem(item));
  }

  public async moveCardOnBoard(params: MoveCardOnBoardParams): Promise<any> {
    const workApi = await this.getWorkApi();
    const teamContext = this.getTeamContext(params.teamId);

    const board = await workApi.getBoard(teamContext, params.boardId);
    const columnField = board.fields?.columnField?.referenceName;
    if (!columnField) throw new Error(`Board "${params.boardId}" has no column field mapping`);

    const column = (board.columns ?? []).find(
      c => c.id === params.columnId || c.name === params.columnId
    );
    if (!column?.name) {
      const available = (board.columns ?? []).map(c => c.name).join(', ');
      throw new Error(
        `Column "${params.columnId}" not found on board "${board.name}". Available: ${available}`
      );
    }

    const patchDocument: JsonPatchOperation[] = [
      { op: Operation.Add, path: `/fields/${columnField}`, value: column.name },
    ];
    const witApi = await this.getWorkItemTrackingApi();
    const updated = await witApi.updateWorkItem(
      undefined,
      patchDocument,
      params.workItemId,
      this.config.project
    );
    return {
      id: updated.id,
      board: board.name,
      column: updated.fields?.[columnField] ?? column.name,
    };
  }

  public async getSprints(params: GetSprintsParams): Promise<any> {
    const workApi = await this.getWorkApi();
    const teamContext = this.getTeamContext(params.teamId);
    return await workApi.getTeamIterations(teamContext);
  }

  public async getCurrentSprint(params: GetCurrentSprintParams): Promise<any> {
    const workApi = await this.getWorkApi();
    const teamContext = this.getTeamContext(params.teamId);
    const currentIterations = await workApi.getTeamIterations(teamContext, 'current');
    return currentIterations && currentIterations.length > 0 ? currentIterations[0] : null;
  }

  /** Ids of the sprint's work items matching extra WIQL conditions. */
  private async sprintItemIds(iterationPath: string, clauses: string[]): Promise<number[]> {
    const conditions = [`[System.IterationPath] = '${wiqlEscape(iterationPath)}'`, ...clauses];
    return this.queryIds(
      `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ${conditions.join(' AND ')} ORDER BY [System.WorkItemType], [System.Id]`,
    );
  }

  public async getSprintWorkItems(params: GetSprintWorkItemsParams): Promise<any[]> {
    const iteration = await this.resolveIteration(params.sprint ?? DEFAULT_SPRINT, params.teamId);
    const ids = await this.sprintItemIds(iteration.path!, buildFilterClauses(params));
    return this.hydrate(ids, DEFAULT_HYDRATE_FIELDS);
  }

  public async getSprintSummary(params: SprintSummaryParams): Promise<Record<string, unknown>> {
    const iteration = await this.resolveIteration(params.sprint ?? DEFAULT_SPRINT, params.teamId);
    const assignee = params.assignedTo ? await this.resolveAssignee(params.assignedTo) : undefined;
    const filters = assignee ? { assignedTo: assignee } : { mine: true };

    const mineIds = await this.sprintItemIds(iteration.path!, [
      ...buildFilterClauses(filters),
      `[System.State] <> '${REMOVED_STATE}'`,
    ]);
    const mine = await this.hydrate(mineIds, DEFAULT_HYDRATE_FIELDS);

    const parentIds = [...new Set(mine.map(row => row.Parent).filter((id): id is number => typeof id === 'number'))];
    const parents = await this.hydrate(parentIds, DEFAULT_HYDRATE_FIELDS);
    const siblingIds = parentIds.length
      ? await this.queryIds(
          `SELECT [System.Id] FROM WorkItems WHERE [System.Parent] IN (${parentIds.join(', ')}) ORDER BY [System.WorkItemType], [System.Id]`,
        )
      : [];
    const mineSet = new Set(mineIds);
    const siblings = (await this.hydrate(siblingIds.filter(id => !mineSet.has(id)), [...DEFAULT_HYDRATE_FIELDS, 'System.IterationPath']))
      .map(({ IterationPath, ...row }) => ({ ...row, Sprint: String(IterationPath ?? '').split('\\').pop() }));

    const delivery = groupDelivery({ mine, parents, siblings, operationalTypes: params.operationalTypes });
    return {
      sprint: { name: iteration.name, path: iteration.path, startDate: iteration.startDate, finishDate: iteration.finishDate },
      assignee: assignee ?? (await this.currentUser()),
      ...delivery,
    };
  }

  public async getSprintCapacity(params: GetSprintCapacityParams): Promise<any> {
    const workApi = await this.getWorkApi();
    const teamContext = this.getTeamContext(params.teamId);
    const iteration = await this.resolveIteration(params.sprint ?? DEFAULT_SPRINT, params.teamId);
    if (!iteration.id) throw new Error(`Sprint "${params.sprint}" has no iteration id`);
    const capacity = await workApi.getCapacitiesWithIdentityRefAndTotals(teamContext, iteration.id);
    if (!capacity) throw new Error(`No capacity found for sprint "${iteration.name}" — is it one of the team's iterations?`);

    return {
      members: (capacity.teamMembers ?? []).map(m => ({
        member: m.teamMember?.displayName,
        activities: (m.activities ?? []).map(a => ({
          name: a.name,
          capacityPerDay: a.capacityPerDay,
        })),
        daysOff: (m.daysOff ?? []).map(d => ({ start: d.start, end: d.end })),
      })),
      totalCapacityPerDay: capacity.totalCapacityPerDay,
      totalDaysOff: capacity.totalDaysOff,
    };
  }

  public async getTeamMembers(params: GetTeamMembersParams): Promise<any> {
    const coreApi = await this.getCoreApi();
    const teamId = params.teamId ?? await this.getDefaultTeamId();
    const members = await coreApi.getTeamMembersWithExtendedProperties(this.config.project, teamId);

    return members.map(m => ({
      displayName: m.identity?.displayName,
      uniqueName: m.identity?.uniqueName,
      ...(m.isTeamAdmin ? { isTeamAdmin: true } : {}),
    }));
  }
}
