import type { WorkApi } from 'azure-devops-node-api/WorkApi';
import type { CoreApi } from 'azure-devops-node-api/CoreApi';
import type { TeamContext } from 'azure-devops-node-api/interfaces/CoreInterfaces';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type { JsonPatchOperation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import { AzureDevOpsService } from './AzureDevOpsService';
import { slimWorkItem, wiqlEscape } from './workItemUtils';
import type {
  GetBoardsParams,
  GetBoardColumnsParams,
  GetBoardItemsParams,
  MoveCardOnBoardParams,
  GetSprintsParams,
  GetCurrentSprintParams,
  GetSprintWorkItemsParams,
  GetSprintCapacityParams,
  GetTeamMembersParams
} from '../interfaces/BoardsAndSprints';

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

  private async getWorkApi(): Promise<WorkApi> {
    return await this.connection.getWorkApi();
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

  public async getSprintWorkItems(params: GetSprintWorkItemsParams): Promise<any> {
    const workApi = await this.getWorkApi();
    const teamContext = this.getTeamContext(params.teamId);
    return await workApi.getIterationWorkItems(teamContext, params.sprintId);
  }

  public async getSprintCapacity(params: GetSprintCapacityParams): Promise<any> {
    const workApi = await this.getWorkApi();
    const teamContext = this.getTeamContext(params.teamId);
    const capacity = await workApi.getCapacitiesWithIdentityRefAndTotals(teamContext, params.sprintId);

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
