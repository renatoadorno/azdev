import type { CoreApi } from 'azure-devops-node-api/CoreApi';
import type { WorkItemTrackingProcessApi } from 'azure-devops-node-api/WorkItemTrackingProcessApi';
import { ProjectVisibility } from 'azure-devops-node-api/interfaces/CoreInterfaces';
import type { TreeStructureGroup, WorkItemClassificationNode } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { FieldType } from 'azure-devops-node-api/interfaces/WorkItemTrackingProcessInterfaces';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import { AzureDevOpsService } from './AzureDevOpsService';
import type {
  ListProjectsParams,
  GetProjectDetailsParams,
  CreateProjectParams,
  GetAreasParams,
  GetIterationsParams,
  CreateAreaParams,
  CreateIterationParams,
  GetProcessesParams,
  GetWorkItemTypesParams,
  GetWorkItemTypeFieldsParams
} from '../interfaces/ProjectManagement';

const CLASSIFICATION_DEPTH = 10;

// TreeStructureGroup.Areas === 0 and the SDK route builder drops falsy route values,
// which would hit the wrong endpoint — so the literal route segments are used instead.
const AREAS_GROUP = 'Areas' as unknown as TreeStructureGroup;
const ITERATIONS_GROUP = 'Iterations' as unknown as TreeStructureGroup;

interface SlimAreaNode {
  name?: string;
  path?: string;
}

interface SlimIterationNode extends SlimAreaNode {
  startDate?: string;
  finishDate?: string;
}

// Classification node paths come as "\Project\Area\Sub", which is not a valid
// System.AreaPath/System.IterationPath value ("Project\Sub") — strip the leading
// backslash and the structural "Area"/"Iteration" segment.
function toFieldPath(path?: string): string | undefined {
  if (!path) return path;
  return path.replace(/^\\/, '').replace(/^([^\\]+)\\(Area|Iteration)(?=\\|$)/, '$1');
}

function flattenAreas(node: WorkItemClassificationNode): SlimAreaNode[] {
  const flat: SlimAreaNode[] = [{ name: node.name, path: toFieldPath(node.path) }];
  for (const child of node.children ?? []) flat.push(...flattenAreas(child));
  return flat;
}

function flattenIterations(node: WorkItemClassificationNode): SlimIterationNode[] {
  const flat: SlimIterationNode[] = [{
    name: node.name,
    path: toFieldPath(node.path),
    startDate: node.attributes?.startDate,
    finishDate: node.attributes?.finishDate,
  }];
  for (const child of node.children ?? []) flat.push(...flattenIterations(child));
  return flat;
}

export class ProjectService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  private async getCoreApi(): Promise<CoreApi> {
    return await this.connection.getCoreApi();
  }

  private async getProcessApi(): Promise<WorkItemTrackingProcessApi> {
    return await this.connection.getWorkItemTrackingProcessApi();
  }

  public async listProjects(params: ListProjectsParams): Promise<any> {
    const coreApi = await this.getCoreApi();
    return await coreApi.getProjects(params.stateFilter, params.top, params.skip);
  }

  public async getProjectDetails(params: GetProjectDetailsParams): Promise<any> {
    const coreApi = await this.getCoreApi();
    return await coreApi.getProject(params.projectId, params.includeCapabilities);
  }

  public async createProject(params: CreateProjectParams): Promise<any> {
    const coreApi = await this.getCoreApi();
    const visibility = params.visibility === 'public'
      ? ProjectVisibility.Public
      : ProjectVisibility.Private;

    return await coreApi.queueCreateProject({
      name: params.name,
      description: params.description,
      visibility,
      capabilities: params.capabilities || {}
    });
  }

  public async getAreas(params: GetAreasParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();
    const root = await witApi.getClassificationNode(
      params.projectId,
      AREAS_GROUP,
      undefined,
      CLASSIFICATION_DEPTH
    );
    return flattenAreas(root);
  }

  public async getIterations(params: GetIterationsParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();
    const root = await witApi.getClassificationNode(
      params.projectId,
      ITERATIONS_GROUP,
      undefined,
      CLASSIFICATION_DEPTH
    );
    return flattenIterations(root);
  }

  public async createArea(params: CreateAreaParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();
    const node = await witApi.createOrUpdateClassificationNode(
      { name: params.name },
      params.projectId,
      AREAS_GROUP,
      params.parentPath
    );
    return { id: node.id, name: node.name, path: toFieldPath(node.path) };
  }

  public async createIteration(params: CreateIterationParams): Promise<any> {
    const attributes: Record<string, string> = {};
    if (params.startDate) attributes.startDate = params.startDate;
    if (params.finishDate) attributes.finishDate = params.finishDate;

    const postedNode: WorkItemClassificationNode = { name: params.name };
    if (Object.keys(attributes).length > 0) postedNode.attributes = attributes;

    const witApi = await this.getWorkItemTrackingApi();
    const node = await witApi.createOrUpdateClassificationNode(
      postedNode,
      params.projectId,
      ITERATIONS_GROUP,
      params.parentPath
    );
    return {
      id: node.id,
      name: node.name,
      path: toFieldPath(node.path),
      startDate: node.attributes?.startDate,
      finishDate: node.attributes?.finishDate,
    };
  }

  public async getProcesses(_params: GetProcessesParams): Promise<any> {
    const coreApi = await this.getCoreApi();
    const processes = await coreApi.getProcesses();
    return processes.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isDefault: p.isDefault,
    }));
  }

  public async getWorkItemTypes(params: GetWorkItemTypesParams): Promise<any> {
    const witProcessApi = await this.getProcessApi();
    return await witProcessApi.getProcessWorkItemTypes(params.processId);
  }

  public async getWorkItemTypeFields(params: GetWorkItemTypeFieldsParams): Promise<any> {
    const witProcessApi = await this.getProcessApi();
    const fields = await witProcessApi.getAllWorkItemTypeFields(params.processId, params.witRefName);
    return fields.map(f => ({
      referenceName: f.referenceName,
      name: f.name,
      type: f.type !== undefined ? FieldType[f.type] : undefined,
      required: f.required,
    }));
  }
}
