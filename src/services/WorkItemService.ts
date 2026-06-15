import type { WorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import type { JsonPatchOperation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import { AzureDevOpsService } from './AzureDevOpsService';
import type {
  WorkItemByIdParams,
  SearchWorkItemsParams,
  RecentWorkItemsParams,
  MyWorkItemsParams,
  CreateWorkItemParams,
  UpdateWorkItemParams,
  AddWorkItemCommentParams,
  UpdateWorkItemStateParams,
  AssignWorkItemParams,
  CreateLinkParams,
  BulkWorkItemParams,
  WorkItemHistoryParams,
  ChildWorkItemsParams
} from '../interfaces/WorkItems';
import {
  CLOSED_STATES,
  HIERARCHY_FORWARD,
  DEFAULT_HYDRATE_FIELDS,
  MULTILINE_FIELDS,
  slimWorkItem,
} from './workItemUtils';

const BATCH_LIMIT = 200;

export class WorkItemService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  /**
   * Fetch full fields for a list of IDs in batches and return compact rows.
   * WIQL only returns id+url, so callers hydrate the references here.
   */
  private async hydrateRefs(ids: number[], fields?: string[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const witApi = await this.getWorkItemTrackingApi();

    const fetched: any[] = [];
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
      const chunk = ids.slice(i, i + BATCH_LIMIT);
      const items = await witApi.getWorkItems(chunk, fields, undefined, undefined, undefined, this.config.project);
      fetched.push(...items);
    }

    const byId = new Map<number, any>(fetched.map(wi => [wi.id, wi]));
    return ids
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(wi => slimWorkItem(wi));
  }

  /**
   * Hydrate a WIQL result (flat or tree), using the queried columns as fields.
   */
  private async hydrateQueryResult(queryResult: any): Promise<any[]> {
    const fields: string[] = (queryResult?.columns ?? [])
      .map((c: any) => c.referenceName)
      .filter(Boolean);

    let ids: number[] = [];
    if (queryResult?.workItems?.length) {
      ids = queryResult.workItems.map((w: any) => w.id).filter((x: any) => typeof x === 'number');
    } else if (queryResult?.workItemRelations?.length) {
      const seen = new Set<number>();
      for (const rel of queryResult.workItemRelations) {
        const tid = rel?.target?.id;
        if (typeof tid === 'number') seen.add(tid);
      }
      ids = [...seen];
    }

    return this.hydrateRefs(ids, fields.length ? fields : undefined);
  }

  /**
   * Get the history of a work item
   */
  public async getWorkItemHistory(params: WorkItemHistoryParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const history = await witApi.getRevisions(params.id, undefined, undefined, undefined, this.config.project);
      return history;
    } catch (error) {
      console.error(`Error getting history for work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Query work items using WIQL
   */
  public async listWorkItems(wiqlQuery: string): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      // Execute the WIQL query
      const queryResult = await witApi.queryByWiql({
        query: wiqlQuery
      }, {
        project: this.config.project
      });

      return this.hydrateQueryResult(queryResult);
    } catch (error) {
      console.error('Error listing work items:', error);
      throw error;
    }
  }

  /**
   * Get a work item by ID
   */
  public async getWorkItemById(params: WorkItemByIdParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      // Only restrict at the API when given full reference names (e.g. System.Title);
      // short names are filtered later by slimWorkItem.
      const fullRefs = (params.fields ?? []).filter(f => f.includes('.'));
      const fields = fullRefs.length === (params.fields?.length ?? 0) && fullRefs.length ? fullRefs : undefined;
      const workItem = await witApi.getWorkItem(params.id, fields, undefined, undefined, this.config.project);
      return workItem;
    } catch (error) {
      console.error(`Error getting work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Search work items using text
   */
  public async searchWorkItems(params: SearchWorkItemsParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const query = `SELECT [System.Id], [System.WorkItemType], [System.State], [System.Title], [System.AssignedTo]
                    FROM WorkItems
                    WHERE [System.TeamProject] = @project
                    AND (
                      [System.Title] CONTAINS '${params.searchText}'
                      OR [System.Description] CONTAINS '${params.searchText}'
                    )
                    ORDER BY [System.CreatedDate] DESC`;

      const queryResult = await witApi.queryByWiql({
        query
      }, {
        project: this.config.project
      });

      if (params.top && queryResult.workItems) {
        queryResult.workItems = queryResult.workItems.slice(0, params.top);
      }

      return this.hydrateQueryResult(queryResult);
    } catch (error) {
      console.error('Error searching work items:', error);
      throw error;
    }
  }

  /**
   * Get recently updated work items
   */
  public async getRecentWorkItems(params: RecentWorkItemsParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const query = `SELECT [System.Id], [System.WorkItemType], [System.State], [System.Title], [System.ChangedDate]
                    FROM WorkItems
                    WHERE [System.TeamProject] = @project
                    ORDER BY [System.ChangedDate] DESC`;

      const queryResult = await witApi.queryByWiql({
        query
      }, {
        project: this.config.project
      });

      const top = params.top || 10;
      const skip = params.skip || 0;

      if (queryResult.workItems) {
        queryResult.workItems = queryResult.workItems.slice(skip, skip + top);
      }

      return this.hydrateQueryResult(queryResult);
    } catch (error) {
      console.error('Error getting recent work items:', error);
      throw error;
    }
  }

  /**
   * Get work items assigned to current user
   */
  public async getMyWorkItems(params: MyWorkItemsParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const conditions: string[] = [];
      if (params.state) {
        conditions.push(`AND [System.State] = '${params.state}'`);
      }
      if (params.openOnly) {
        conditions.push(`AND [System.State] NOT IN (${CLOSED_STATES.map(s => `'${s}'`).join(', ')})`);
      }
      if (params.path) {
        conditions.push(`AND [System.IterationPath] = '${params.path}'`);
      }

      const query = `SELECT [System.Id], [System.WorkItemType], [System.State], [System.Title]
                    FROM WorkItems
                    WHERE [System.TeamProject] = @project
                    AND [System.AssignedTo] = @me
                    ${conditions.join('\n                    ')}
                    ORDER BY [System.CreatedDate] DESC`;

      const queryResult = await witApi.queryByWiql({
        query
      }, {
        project: this.config.project
      });

      const top = params.top || 100;

      if (queryResult.workItems) {
        queryResult.workItems = queryResult.workItems.slice(0, top);
      }

      return this.hydrateQueryResult(queryResult);
    } catch (error) {
      console.error('Error getting my work items:', error);
      throw error;
    }
  }

  /**
   * Get children of a work item (direct or recursive), with optional
   * assignee / state / open filters. Returns compact hydrated rows.
   */
  public async getChildWorkItems(params: ChildWorkItemsParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();

      const filters: string[] = [];
      if (params.mine) filters.push(`[{scope}].[System.AssignedTo] = @me`);
      if (params.state) filters.push(`[{scope}].[System.State] = '${params.state}'`);
      if (params.openOnly) {
        filters.push(`[{scope}].[System.State] NOT IN (${CLOSED_STATES.map(s => `'${s}'`).join(', ')})`);
      }
      if (params.type) filters.push(`[{scope}].[System.WorkItemType] = '${params.type}'`);

      let query: string;
      if (params.recursive) {
        const targetFilters = filters
          .map(f => `AND ${f.replace(/\{scope\}/g, 'Target')}`)
          .join(' ');
        query = `SELECT [System.Id]
                 FROM WorkItemLinks
                 WHERE ([Source].[System.Id] = ${params.id})
                 AND ([System.Links.LinkType] = '${HIERARCHY_FORWARD}')
                 ${targetFilters}
                 MODE (Recursive)`;
      } else {
        const flatFilters = filters
          .map(f => `AND ${f.replace(/\[\{scope\}\]\./g, '')}`)
          .join(' ');
        query = `SELECT [System.Id]
                 FROM WorkItems
                 WHERE [System.Parent] = ${params.id}
                 ${flatFilters}
                 ORDER BY [System.WorkItemType], [System.Id]`;
      }

      const queryResult = await witApi.queryByWiql({ query }, { project: this.config.project });

      let ids: number[] = [];
      if (queryResult.workItems?.length) {
        ids = queryResult.workItems.map((w: any) => w.id).filter((x: any) => typeof x === 'number');
      } else if (queryResult.workItemRelations?.length) {
        const seen = new Set<number>();
        for (const rel of queryResult.workItemRelations) {
          const tid = rel?.target?.id;
          if (typeof tid === 'number' && tid !== params.id) seen.add(tid);
        }
        ids = [...seen];
      }

      return this.hydrateRefs(ids, DEFAULT_HYDRATE_FIELDS);
    } catch (error) {
      console.error(`Error getting children of work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Create a work item
   */
  public async createWorkItem(params: CreateWorkItemParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [];
      
      // Add title
      patchDocument.push({
        op: Operation.Add,
        path: "/fields/System.Title",
        value: params.title
      });
      
      // Add description if provided
      if (params.description) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.Description",
          value: params.description
        });
      }
      
      // Add assigned to if provided
      if (params.assignedTo) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.AssignedTo",
          value: params.assignedTo
        });
      }
      
      // Add state if provided
      if (params.state) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.State",
          value: params.state
        });
      }
      
      // Add area path if provided
      if (params.areaPath) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.AreaPath",
          value: params.areaPath
        });
      }
      
      // Add iteration path if provided
      if (params.iterationPath) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.IterationPath",
          value: params.iterationPath
        });
      }
      
      // Add additional fields if provided
      if (params.additionalFields) {
        for (const [key, value] of Object.entries(params.additionalFields)) {
          patchDocument.push({
            op: Operation.Add,
            path: `/fields/${key}`,
            value: value
          });
        }
      }
      
      const workItem = await witApi.createWorkItem(
        undefined,
        patchDocument,
        this.config.project,
        params.workItemType
      );
      
      return workItem;
    } catch (error) {
      console.error('Error creating work item:', error);
      throw error;
    }
  }

  /**
   * Update a work item
   */
  public async updateWorkItem(params: UpdateWorkItemParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [];

      // Add fields from the params
      for (const [key, value] of Object.entries(params.fields)) {
        patchDocument.push({
          op: Operation.Add,
          path: `/fields/${key}`,
          value: value
        });
      }

      // Mark rich-text format (HTML vs Markdown) for the multiline fields touched.
      if (params.format) {
        const formatValue = params.format === 'markdown' ? 'Markdown' : 'Html';
        for (const key of Object.keys(params.fields)) {
          if (MULTILINE_FIELDS.includes(key)) {
            patchDocument.push({
              op: Operation.Add,
              path: `/multilineFieldsFormat/${key}`,
              value: formatValue
            });
          }
        }
      }

      const workItem = await witApi.updateWorkItem(
        undefined,
        patchDocument,
        params.id,
        this.config.project
      );

      return workItem;
    } catch (error) {
      console.error(`Error updating work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Add a comment to a work item
   */
  public async addWorkItemComment(params: AddWorkItemCommentParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const comment = await witApi.addComment({
        text: params.text
      }, this.config.project, params.id);
      
      return comment;
    } catch (error) {
      console.error(`Error adding comment to work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Update work item state
   */
  public async updateWorkItemState(params: UpdateWorkItemStateParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: "/fields/System.State",
          value: params.state
        }
      ];
      
      // Add comment if provided
      if (params.comment) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.History",
          value: params.comment
        });
      }
      
      const workItem = await witApi.updateWorkItem(
        undefined,
        patchDocument,
        params.id,
        this.config.project
      );
      
      return workItem;
    } catch (error) {
      console.error(`Error updating state for work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Assign work item to a user
   */
  public async assignWorkItem(params: AssignWorkItemParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: "/fields/System.AssignedTo",
          value: params.assignedTo
        }
      ];
      
      const workItem = await witApi.updateWorkItem(
        undefined,
        patchDocument,
        params.id,
        this.config.project
      );
      
      return workItem;
    } catch (error) {
      console.error(`Error assigning work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Create a link between work items
   */
  public async createLink(params: CreateLinkParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: "/relations/-",
          value: {
            rel: params.linkType,
            url: `${this.config.orgUrl}/_apis/wit/workItems/${params.targetId}`,
            attributes: {
              comment: params.comment || ""
            }
          }
        }
      ];
      
      const workItem = await witApi.updateWorkItem(
        undefined,
        patchDocument,
        params.sourceId,
        this.config.project
      );
      
      return workItem;
    } catch (error) {
      console.error(`Error creating link between work items:`, error);
      throw error;
    }
  }

  /**
   * Bulk create or update work items
   */
  public async bulkUpdateWorkItems(params: BulkWorkItemParams): Promise<any> {
    try {
      const results = [];
      
      for (const workItemParams of params.workItems) {
        if ('id' in workItemParams) {
          // It's an update
          const result = await this.updateWorkItem(workItemParams);
          results.push(result);
        } else {
          // It's a create
          const result = await this.createWorkItem(workItemParams);
          results.push(result);
        }
      }
      
      return {
        count: results.length,
        workItems: results
      };
    } catch (error) {
      console.error('Error in bulk work item operation:', error);
      throw error;
    }
  }
} 