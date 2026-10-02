import * as azdev from "azure-devops-node-api";
import { WorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import type { WorkApi } from "azure-devops-node-api/WorkApi";
import { WorkItemErrorPolicy } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import type { TreeStructureGroup } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import type { AzureDevOpsConfig } from "../interfaces/AzureDevOps";
import {
  getPersonalAccessTokenHandler,
  getNtlmHandler,
  getBasicHandler,
} from "azure-devops-node-api/WebApi";
import * as VsoBaseInterfaces from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces";
import type { IRequestHandler } from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces";
import {
  CURRENT_SPRINT_ALIASES,
  flattenIterations,
  matchIteration,
  suggestIterations,
  type SlimIterationNode,
} from "./iterations";
import { ME, slimWorkItem } from "./workItemUtils";
import { resolveField, resolveFieldOffline, suggestFields, type FieldDefinition } from "./fieldNames";

export const CLASSIFICATION_DEPTH = 10;

// TreeStructureGroup.Areas === 0 and the SDK route builder drops falsy route values,
// which would hit the wrong endpoint — so the literal route segments are used instead.
export const AREAS_GROUP = 'Areas' as unknown as TreeStructureGroup;
export const ITERATIONS_GROUP = 'Iterations' as unknown as TreeStructureGroup;

/** getWorkItems accepts at most 200 ids per call. */
const BATCH_LIMIT = 200;

export class AzureDevOpsService {
  protected connection: azdev.WebApi;
  protected config: AzureDevOpsConfig;
  protected authHandler: IRequestHandler | undefined;
  private currentUserPromise?: Promise<string>;
  private iterationsPromise?: Promise<SlimIterationNode[]>;
  private fieldsPromise?: Promise<FieldDefinition[]>;

  constructor(config: AzureDevOpsConfig) {
    this.config = config;

    // Get the appropriate authentication handler

    if (config.auth?.type === "entra") {
      if (config.isOnPremises) {
        throw new Error(
          "Azure Identity (DefaultAzureCredential) authentication is not supported for on-premises Azure DevOps."
        );
      }
      if(!config.entraAuthHandler) {
        throw new Error(
          "Entra authentication requires an instance of EntraAuthHandler."
        );
      }
      this.authHandler = config.entraAuthHandler;
    } else if (config.isOnPremises && config.auth) {
      switch (config.auth.type) {
        case 'ntlm':
          if (!config.auth.username || !config.auth.password) {
            throw new Error(
              "NTLM authentication requires username and password"
            );
          }
          this.authHandler = getNtlmHandler(
            config.auth.username,
            config.auth.password,
            config.auth.domain
          );
          break;
        case 'basic':
          if (!config.auth.username || !config.auth.password) {
            throw new Error(
              "Basic authentication requires username and password"
            );
          }
          this.authHandler = getBasicHandler(
            config.auth.username,
            config.auth.password
          );
          break;
        case 'pat':
        default: // Default to PAT for on-premises if auth type is missing or unrecognized
          if (!config.personalAccessToken) {
            throw new Error(
              "PAT authentication requires a personal access token for on-premises if specified or as fallback."
            );
          }
          this.authHandler = getPersonalAccessTokenHandler(config.personalAccessToken);
      }
    } else {
      // Cloud environment, and not 'entra'
      if (config.auth?.type === "pat" || !config.auth) {
        // Explicitly PAT or no auth specified (defaults to PAT for cloud)
        if (!config.personalAccessToken) {
          throw new Error(
            "Personal Access Token is required for cloud authentication when auth type is PAT or not specified."
          );
        }
        this.authHandler = getPersonalAccessTokenHandler(config.personalAccessToken);
      } else {
        // This case should ideally not be reached if config is validated correctly
        throw new Error(
          `Unsupported authentication type "${config.auth?.type}" for Azure DevOps cloud.`
        );
      }
    }

    // Create the connection with the appropriate base URL
    let baseUrl = config.orgUrl;
    if (config.isOnPremises && config.collection) {
      // For on-premises, ensure the collection is included in the URL
      baseUrl = `${config.orgUrl}/${config.collection}`;
    }

    // Create options for the WebApi
    const requestOptions: VsoBaseInterfaces.IRequestOptions = {};

    // For on-premises with API version specification, we'll add it to request headers
    if (config.isOnPremises && config.apiVersion) {
      requestOptions.headers = {
        Accept: `application/json;api-version=${config.apiVersion}`,
      };
    }

    // Create the WebApi instance
    // At this point, authHandler is guaranteed to be defined or an error would have been thrown.
    this.connection = new azdev.WebApi(baseUrl, this.authHandler, requestOptions);
  }

  /**
   * Get the WorkItemTracking API client
   */
  protected async getWorkItemTrackingApi(): Promise<WorkItemTrackingApi> {
    return await this.connection.getWorkItemTrackingApi();
  }

  protected async getWorkApi(): Promise<WorkApi> {
    return await this.connection.getWorkApi();
  }

  /** Browser link to a work item. */
  protected webUrl(id: number): string {
    return `${this.config.orgUrl}/${encodeURIComponent(this.config.project)}/_workitems/edit/${id}`;
  }

  /** Account (e-mail) of the authenticated user — what `@me` stands for in assignments. */
  protected currentUser(): Promise<string> {
    this.currentUserPromise ??= this.connection.connect().then(data => {
      const user = data.authenticatedUser;
      const account = user?.properties?.Account?.$value ?? user?.providerDisplayName;
      if (!account) throw new Error('Could not resolve the authenticated user for @me');
      return account as string;
    });
    return this.currentUserPromise;
  }

  /** `@me` → the authenticated account; anything else passes through. */
  protected async resolveAssignee(value?: string): Promise<string | undefined> {
    if (!value) return value;
    return value.trim().toLowerCase() === ME ? this.currentUser() : value;
  }

  /** Every field of the project, reference and display name. */
  protected projectFields(): Promise<FieldDefinition[]> {
    this.fieldsPromise ??= this.getWorkItemTrackingApi()
      .then(witApi => witApi.getFields(this.config.project))
      .then(fields => (fields ?? []).map(f => ({ referenceName: f.referenceName, name: f.name })));
    return this.fieldsPromise;
  }

  /**
   * Field names as written (`assignedTo`, `Remaining Work`, `Custom.Squad`) → reference
   * names. The project's field list is fetched only for a name no alias covers.
   */
  protected async resolveFieldNames(names: string[]): Promise<string[]> {
    const offline = names.map(resolveFieldOffline);
    if (offline.every(Boolean)) return offline as string[];
    const known = await this.projectFields();
    return names.map((name, i) => {
      const ref = offline[i] ?? resolveField(name, known);
      if (ref) return ref;
      const suggestions = suggestFields(name, known);
      const hint = suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : '';
      throw new Error(`Unknown field "${name}".${hint} List them with 'azdev metadata fields'.`);
    });
  }

  private projectIterations(): Promise<SlimIterationNode[]> {
    this.iterationsPromise ??= this.getWorkItemTrackingApi()
      .then(witApi => witApi.getClassificationNode(this.config.project, ITERATIONS_GROUP, undefined, CLASSIFICATION_DEPTH))
      .then(root => flattenIterations(root));
    return this.iterationsPromise;
  }

  /**
   * Resolves a `--sprint` value — `current`, a number (`82`), a name (`Sprint 82`),
   * a full path or a GUID — to the iteration it names.
   */
  protected async resolveIteration(value: string, teamId?: string): Promise<SlimIterationNode> {
    if (CURRENT_SPRINT_ALIASES.includes(value.trim().toLowerCase())) {
      const workApi = await this.getWorkApi();
      const [current] = await workApi.getTeamIterations({ project: this.config.project, team: teamId }, 'current');
      if (!current?.path) throw new Error(`No current sprint found for project "${this.config.project}"`);
      return {
        id: current.id,
        name: current.name,
        path: current.path,
        startDate: current.attributes?.startDate?.toString(),
        finishDate: current.attributes?.finishDate?.toString(),
      };
    }

    const iterations = await this.projectIterations();
    const match = matchIteration(value, iterations);
    if (match?.path) return match;

    const suggestions = suggestIterations(value, iterations);
    const hint = suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : " List them with 'azdev sprint list'.";
    throw new Error(`Sprint "${value}" not found in project "${this.config.project}".${hint}`);
  }

  /**
   * Batch-fetches the given ids and returns compact rows in the same order.
   * Ids that are deleted or unreadable (area security) are left out instead of
   * failing the whole batch.
   */
  protected async hydrate(ids: number[], fields?: string[]): Promise<any[]> {
    if (ids.length === 0) return [];
    const witApi = await this.getWorkItemTrackingApi();

    const fetched: any[] = [];
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
      const chunk = ids.slice(i, i + BATCH_LIMIT);
      const items = await witApi.getWorkItems(chunk, fields, undefined, undefined, WorkItemErrorPolicy.Omit, this.config.project);
      // Omit returns null in place of a missing item; a 404 resolves the whole call as null.
      fetched.push(...(items ?? []).filter(Boolean));
    }

    const byId = new Map<number, any>(fetched.map(wi => [wi.id, wi]));
    return ids
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(wi => slimWorkItem(wi));
  }

  /** Runs a WIQL query and returns the ids it matched, in query order. */
  protected async queryIds(query: string, top?: number): Promise<number[]> {
    const result = await this.runWiql(query, top);
    return (result.workItems ?? [])
      .map(w => w.id)
      .filter((id): id is number => typeof id === 'number');
  }

  /** Runs a WIQL query; past 20,000 matches (VS402337) the error asks to narrow it. */
  protected async runWiql(query: string, top?: number) {
    const witApi = await this.getWorkItemTrackingApi();
    try {
      return await witApi.queryByWiql({ query }, { project: this.config.project }, undefined, top);
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      if (!/VS402337/.test(message)) throw err;
      throw Object.assign(new Error(`${message} — narrow the filters (type, sprint, dates)`), {
        statusCode: (err as { statusCode?: number }).statusCode,
      });
    }
  }
}
