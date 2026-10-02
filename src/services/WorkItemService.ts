import type { JsonPatchOperation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { CommentFormat, CommentSortOrder, TypeInfo } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { Comment } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
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
  ChildWorkItemsParams,
  ListCommentsParams,
  QueryWorkItemsParams,
} from '../interfaces/WorkItems';
import {
  HIERARCHY_FORWARD,
  DEFAULT_HYDRATE_FIELDS,
  WRITE_SUMMARY_FIELDS,
  buildFilterClauses,
  fieldOperations,
  parentRelationOperation,
  parseTags,
  shortKey,
  simplifyValue,
  slimWorkItem,
  wiqlEscape,
} from './workItemUtils';
import {
  DEFAULT_ORDER_BY,
  buildOrderBy,
  buildWiql,
  groupCounts,
  parseSince,
  queryConditions,
  rewriteFieldRefs,
} from './queryBuilder';
import { richTextToPlain } from './richText';
import { checkDescription, fillTemplate, needsParentTitle } from './descriptionTemplates';

// Comments resource; 7.1-preview.4 is the first version that takes `format`.
const COMMENTS_LOCATION_ID = '608aac0a-32e1-4493-a863-b9cf4566d257';
const COMMENTS_FORMAT_API_VERSION = '7.1-preview.4';

export interface CreateRequest {
  workItemType: string;
  operations: JsonPatchOperation[];
  /** Non-blocking problems with the request (sections missing from a templated description). */
  warnings: string[];
}

export interface SlimComment {
  id?: number;
  author?: string;
  date?: string;
  text?: string;
  format?: string;
}

export class WorkItemService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  /** Compact confirmation of a write: the fields that matter plus a browser link. */
  public summarize(workItem: any): Record<string, unknown> {
    return { ...slimWorkItem(workItem, WRITE_SUMMARY_FIELDS), url: this.webUrl(workItem.id) };
  }

  /** Ids of a WIQL result, flat or tree (link query targets, without `excludeId`). */
  private idsOf(queryResult: any, excludeId?: number): number[] {
    if (queryResult?.workItems?.length) {
      return queryResult.workItems.map((w: any) => w.id).filter((x: any) => typeof x === 'number');
    }
    const seen = new Set<number>();
    for (const rel of queryResult?.workItemRelations ?? []) {
      const tid = rel?.target?.id;
      if (typeof tid === 'number' && tid !== excludeId) seen.add(tid);
    }
    return [...seen];
  }

  /**
   * Hydrate a WIQL result (flat or tree), using the queried columns as fields.
   */
  private async hydrateQueryResult(queryResult: any, excludeId?: number): Promise<any[]> {
    const fields: string[] = (queryResult?.columns ?? [])
      .map((c: any) => c.referenceName)
      .filter(Boolean);
    return this.hydrate(this.idsOf(queryResult, excludeId), fields.length ? fields : undefined);
  }

  /**
   * The WIQL of a free query: filters, a free condition and an order, with field
   * names resolved — or the whole query as given.
   */
  public async buildQuery(params: QueryWorkItemsParams): Promise<string> {
    if (params.wiql) return params.wiql.trim();

    // Collect the short names first: resolving may need the project's field list.
    const names: string[] = [];
    const collect = (name: string) => (names.push(name), name);
    if (params.where) rewriteFieldRefs(params.where, collect);
    if (params.orderBy) buildOrderBy(params.orderBy, collect);
    const refs = new Map(names.length ? (await this.resolveFieldNames(names)).map((ref, i) => [names[i]!, ref]) : []);
    const resolve = (name: string) => refs.get(name) ?? name;

    const conditions = queryConditions({
      mine: params.mine,
      assignedTo: params.assignedTo,
      unassigned: params.unassigned,
      types: params.types,
      states: params.states,
      openOnly: params.openOnly,
      iterationPath: params.sprint ? (await this.resolveIteration(params.sprint)).path : undefined,
      areaPath: params.area,
      tags: params.tags,
      text: params.text,
      parentId: params.parentId,
      createdSince: params.createdSince ? parseSince(params.createdSince) : undefined,
      changedSince: params.changedSince ? parseSince(params.changedSince) : undefined,
      closedSince: params.closedSince ? parseSince(params.closedSince) : undefined,
      where: params.where ? rewriteFieldRefs(params.where, resolve) : undefined,
    });
    return buildWiql(conditions, params.orderBy ? buildOrderBy(params.orderBy, resolve) : DEFAULT_ORDER_BY);
  }

  /** Runs a free query: rows, a count, or counts grouped by fields. */
  public async queryWorkItems(params: QueryWorkItemsParams): Promise<unknown> {
    const wiql = await this.buildQuery(params);
    if (params.printWiql) return { wiql };

    const fields = params.fields ? await this.resolveFieldNames(params.fields) : undefined;
    const groupBy = params.groupBy ? await this.resolveFieldNames(params.groupBy) : undefined;
    const everything = params.count || groupBy;
    const top = everything || !params.top ? undefined : params.top;

    const result = await this.runWiql(wiql, top);
    const ids = this.idsOf(result);

    if (params.count) return { count: ids.length };
    if (groupBy) {
      const rows = await this.hydrate(ids, groupBy);
      return { total: ids.length, groups: groupCounts(rows, groupBy.map(shortKey)) };
    }
    if (top && ids.length >= top) {
      console.error(`Warning: showing the first ${top} matches — raise --top, or use --count/--groupBy for totals.`);
    }
    // A whole WIQL query keeps its own columns unless --fields says otherwise.
    const columns = fields ?? (params.wiql ? (result.columns ?? []).map(c => c.referenceName!).filter(Boolean) : []);
    const rows = await this.hydrate(ids, columns.length ? columns : DEFAULT_HYDRATE_FIELDS);
    if (!fields) return rows;
    // The asked columns, in the asked order, empty where an item has no value — one table every time.
    const keys = [...new Set(fields.map(shortKey))].filter(key => key !== 'Id');
    return rows.map(row => ({ id: row.id, ...Object.fromEntries(keys.map(key => [key, row[key] ?? ''])) }));
  }

  /**
   * Get the history of a work item
   */
  public async getWorkItemHistory(params: WorkItemHistoryParams): Promise<any[]> {
    const witApi = await this.getWorkItemTrackingApi();
    // Revisions come in pages; an old item would otherwise lose exactly its latest changes.
    const pageSize = 200;
    const revisions: any[] = [];
    for (let skip = 0; ; skip += pageSize) {
      const page = await witApi.getRevisions(params.id, pageSize, skip, undefined, this.config.project);
      if (!page) {
        if (skip === 0) throw new Error(`Work item ${params.id} not found`);
        break;
      }
      revisions.push(...page);
      if (page.length < pageSize) break;
    }
    return revisions;
  }

  /**
   * Query work items using WIQL
   */
  public async listWorkItems(wiqlQuery: string): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();

    const queryResult = await witApi.queryByWiql({
      query: wiqlQuery
    }, {
      project: this.config.project
    });

    return this.hydrateQueryResult(queryResult);
  }

  /**
   * Get a work item by ID
   */
  public async getWorkItemById(params: WorkItemByIdParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();
    // Only restrict at the API when given full reference names (e.g. System.Title);
    // short names are filtered later by slimWorkItem.
    const fullRefs = (params.fields ?? []).filter(f => f.includes('.'));
    const fields = fullRefs.length === (params.fields?.length ?? 0) && fullRefs.length ? fullRefs : undefined;
    const workItem = await witApi.getWorkItem(params.id, fields, undefined, undefined, this.config.project);
    // typed-rest-client resolves 404 as null instead of rejecting.
    if (!workItem) throw new Error(`Work item ${params.id} not found`);
    return workItem;
  }

  /**
   * Search work items using text
   */
  public async searchWorkItems(params: SearchWorkItemsParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();
    const searchText = wiqlEscape(params.searchText);
    const query = `SELECT [System.Id], [System.WorkItemType], [System.State], [System.Title], [System.AssignedTo]
                  FROM WorkItems
                  WHERE [System.TeamProject] = @project
                  AND (
                    [System.Title] CONTAINS '${searchText}'
                    OR [System.Description] CONTAINS '${searchText}'
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
  }

  /**
   * Get recently updated work items
   */
  public async getRecentWorkItems(params: RecentWorkItemsParams): Promise<any> {
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
  }

  /**
   * Get work items assigned to current user
   */
  public async getMyWorkItems(params: MyWorkItemsParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();
    const path = params.sprint ? (await this.resolveIteration(params.sprint)).path : params.path;
    const conditions = [
      '[System.AssignedTo] = @me',
      ...buildFilterClauses({ state: params.state, openOnly: params.openOnly }),
      ...(path ? [`[System.IterationPath] = '${wiqlEscape(path)}'`] : []),
    ];

    const query = `SELECT [System.Id], [System.WorkItemType], [System.State], [System.Title]
                  FROM WorkItems
                  WHERE [System.TeamProject] = @project
                  ${conditions.map(c => `AND ${c}`).join('\n                  ')}
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
  }

  /**
   * Get children of a work item (direct or recursive), with optional
   * assignee / state / open filters. Returns compact hydrated rows.
   */
  public async getChildWorkItems(params: ChildWorkItemsParams, fields = DEFAULT_HYDRATE_FIELDS): Promise<any[]> {
    const witApi = await this.getWorkItemTrackingApi();

    let query: string;
    if (params.recursive) {
      const targetFilters = buildFilterClauses(params, 'Target').map(c => `AND ${c}`).join(' ');
      query = `SELECT [System.Id]
               FROM WorkItemLinks
               WHERE ([Source].[System.Id] = ${params.id})
               AND ([System.Links.LinkType] = '${HIERARCHY_FORWARD}')
               ${targetFilters}
               MODE (Recursive)`;
    } else {
      const flatFilters = buildFilterClauses(params).map(c => `AND ${c}`).join(' ');
      query = `SELECT [System.Id]
               FROM WorkItems
               WHERE [System.Parent] = ${params.id}
               ${flatFilters}
               ORDER BY [System.WorkItemType], [System.Id]`;
    }

    const queryResult = await witApi.queryByWiql({ query }, { project: this.config.project });
    const withFields = { ...queryResult, columns: fields.map(referenceName => ({ referenceName })) };
    return this.hydrateQueryResult(withFields, params.id);
  }

  /**
   * Resolves every convenience of `create` (sprint, @me, parent inheritance, tags,
   * format) into the exact request — what `--dryRun` prints and `create` sends.
   */
  public async buildCreateRequest(params: CreateWorkItemParams): Promise<CreateRequest> {
    let { areaPath, iterationPath } = params;
    if (params.sprint) iterationPath = (await this.resolveIteration(params.sprint)).path;

    const model = params.descriptionModel;
    let parentTitle: string | undefined;

    // Same as "add child" on the board: the child lands in the parent's area and sprint.
    const needsParent = !areaPath || !iterationPath || (model !== undefined && needsParentTitle(model.content));
    if (params.parentId && needsParent) {
      const parent = await this.getWorkItemById({
        id: params.parentId,
        fields: ['System.AreaPath', 'System.IterationPath', 'System.Title'],
      });
      areaPath ??= parent.fields?.['System.AreaPath'];
      iterationPath ??= parent.fields?.['System.IterationPath'];
      parentTitle = parent.fields?.['System.Title'];
    }

    // A template is a model to write from: refuse a card without its own content.
    const warnings: string[] = [];
    if (model) {
      const filled = fillTemplate(model.content, { title: params.title, parentId: params.parentId, parentTitle });
      const check = checkDescription(params.description, filled, model.name);
      if (check.error) throw new Error(check.error);
      if (check.missing.length) {
        warnings.push(`The description leaves out sections of the "${model.name}" template: ${check.missing.join(', ')}`);
      }
    }
    // Templates are Markdown, so a description written from one is too.
    const format = params.format ?? (model ? 'markdown' : this.config.richTextFormat);

    const fields: Record<string, unknown> = {
      'System.Title': params.title,
      'System.Description': params.description,
      'System.AssignedTo': await this.resolveAssignee(params.assignedTo),
      'System.State': params.state,
      'System.AreaPath': areaPath,
      'System.IterationPath': iterationPath,
      'System.Tags': parseTags(params.tags),
      ...params.additionalFields,
    };

    const operations = fieldOperations(fields, format);
    if (params.parentId) operations.push(parentRelationOperation(this.config.orgUrl, params.parentId));
    return { workItemType: params.workItemType, operations, warnings };
  }

  /**
   * Create a work item — parent link, tags and sprint go in the same request.
   */
  public async createWorkItem(params: CreateWorkItemParams): Promise<any> {
    const request = await this.buildCreateRequest(params);
    for (const warning of request.warnings) console.error(`Warning: ${warning}`);
    const witApi = await this.getWorkItemTrackingApi();
    try {
      return await witApi.createWorkItem(undefined, request.operations, this.config.project, request.workItemType);
    } catch (err) {
      throw await this.explainStateError(err, params.state, params.workItemType);
    }
  }

  /**
   * Update a work item
   */
  public async updateWorkItem(params: UpdateWorkItemParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();
    const fields = { ...params.fields };
    if (params.sprint) fields['System.IterationPath'] = (await this.resolveIteration(params.sprint)).path;

    const operations = fieldOperations(fields, params.format ?? this.config.richTextFormat);
    try {
      return await witApi.updateWorkItem(undefined, operations, params.id, this.config.project);
    } catch (err) {
      const state = fields['System.State'];
      throw await this.explainStateError(err, typeof state === 'string' ? state : undefined, undefined, params.id);
    }
  }

  /**
   * Add a comment to a work item. Markdown goes through the versioned endpoint
   * that accepts `format`; the SDK's addComment only speaks HTML.
   */
  public async addWorkItemComment(params: AddWorkItemCommentParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();
    const format = params.format ?? this.config.richTextFormat;
    if (format !== 'markdown') {
      return witApi.addComment({ text: params.text }, this.config.project, params.id);
    }

    const verData = await witApi.vsoClient.getVersioningData(
      COMMENTS_FORMAT_API_VERSION,
      'wit',
      COMMENTS_LOCATION_ID,
      { project: this.config.project, workItemId: params.id },
      { format: 'markdown' },
    );
    const options = witApi.createRequestOptions('application/json', verData.apiVersion);
    const res = await witApi.rest.create(verData.requestUrl!, { text: params.text }, options);
    const comment: Comment = witApi.formatResponse(res.result, TypeInfo.Comment, false);
    if (comment?.format !== CommentFormat.Markdown) {
      console.error(`Warning: the server stored comment ${comment?.id} as HTML — line breaks may be lost.`);
    }
    return comment;
  }

  /** Compact view of a comment, as plain text unless `raw`. */
  public slimComment(comment: Comment, raw = false): SlimComment {
    const format = comment.format === CommentFormat.Markdown ? 'markdown' : 'html';
    return {
      id: comment.id,
      author: simplifyValue(comment.createdBy) as string | undefined,
      date: comment.createdDate ? new Date(comment.createdDate).toISOString() : undefined,
      text: raw ? comment.text : richTextToPlain(comment.text, format),
      ...(raw ? { format } : {}),
    };
  }

  /** Latest comments of a work item, oldest first. */
  public async getComments(params: ListCommentsParams): Promise<{ total: number; comments: SlimComment[] }> {
    const witApi = await this.getWorkItemTrackingApi();
    const list = await witApi.getComments(
      this.config.project,
      params.id,
      params.top,
      undefined,
      false,
      undefined,
      CommentSortOrder.Desc,
    );
    if (!list) throw new Error(`Work item ${params.id} not found`);
    const comments = [...(list.comments ?? [])].reverse().map(c => this.slimComment(c, params.raw));
    return { total: list.totalCount ?? comments.length, comments };
  }

  /**
   * Update work item state
   */
  public async updateWorkItemState(params: UpdateWorkItemStateParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();

    const patchDocument: JsonPatchOperation[] = [
      {
        op: Operation.Add,
        path: "/fields/System.State",
        value: params.state
      }
    ];

    if (params.comment) {
      patchDocument.push({
        op: Operation.Add,
        path: "/fields/System.History",
        value: params.comment
      });
    }

    try {
      return await witApi.updateWorkItem(undefined, patchDocument, params.id, this.config.project);
    } catch (err) {
      throw await this.explainStateError(err, params.state, undefined, params.id);
    }
  }

  /**
   * States differ per type (an Issue has no Removed), and the API rejects a wrong
   * one with a generic rule error. Turn that into the list of valid states.
   */
  private async explainStateError(err: unknown, state?: string, type?: string, id?: number): Promise<unknown> {
    if (!state) return err;
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const workItemType = type ?? (id ? (await this.getWorkItemById({ id, fields: ['System.WorkItemType'] })).fields?.['System.WorkItemType'] : undefined);
      if (!workItemType) return err;

      const states = (await witApi.getWorkItemTypeStates(this.config.project, workItemType)).map(s => s.name ?? '');
      if (states.some(s => s.toLowerCase() === state.toLowerCase())) return err;
      return new Error(`State "${state}" is not valid for ${workItemType}. Valid states: ${states.join(', ')}`);
    } catch {
      return err;
    }
  }

  /**
   * Assign work item to a user
   */
  public async assignWorkItem(params: AssignWorkItemParams): Promise<any> {
    const witApi = await this.getWorkItemTrackingApi();

    const patchDocument: JsonPatchOperation[] = [
      {
        op: Operation.Add,
        path: "/fields/System.AssignedTo",
        value: await this.resolveAssignee(params.assignedTo)
      }
    ];

    return witApi.updateWorkItem(
      undefined,
      patchDocument,
      params.id,
      this.config.project
    );
  }

  /**
   * Create a link between work items
   */
  public async createLink(params: CreateLinkParams): Promise<any> {
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

    return witApi.updateWorkItem(
      undefined,
      patchDocument,
      params.sourceId,
      this.config.project
    );
  }

  /**
   * Bulk create or update work items
   */
  public async bulkUpdateWorkItems(params: BulkWorkItemParams): Promise<any[]> {
    const results = [];

    for (const workItemParams of params.workItems) {
      if ('id' in workItemParams) {
        results.push(await this.updateWorkItem(workItemParams));
      } else {
        results.push(await this.createWorkItem(workItemParams));
      }
    }

    return results;
  }
}
