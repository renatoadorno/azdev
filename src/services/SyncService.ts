import type { CoreApi } from 'azure-devops-node-api/CoreApi';
import { TimeFrame } from 'azure-devops-node-api/interfaces/WorkInterfaces';
import { WorkItemErrorPolicy, type WorkItemType } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import type { RawItem, RawMeta, RawSprint, RawType, SyncSource } from '../interfaces/Sync';
import { AREAS_GROUP, AzureDevOpsService, BATCH_LIMIT, CLASSIFICATION_DEPTH, ITERATIONS_GROUP } from './AzureDevOpsService';
import { flattenAreas, flattenIterations } from './iterations';

const TIMEFRAMES: Record<number, RawSprint['timeframe']> = {
  [TimeFrame.Past]: 'past',
  [TimeFrame.Current]: 'current',
  [TimeFrame.Future]: 'future',
};

function iso(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  return typeof value === 'string' && value ? value : undefined;
}

function toRawType(type: WorkItemType): RawType {
  return {
    name: type.name,
    color: type.color,
    isDisabled: type.isDisabled,
    states: (type.states ?? []).map(s => ({ name: s.name, category: s.category, color: s.color })),
    transitions: type.transitions
      ? Object.fromEntries(Object.entries(type.transitions).map(([from, to]) => [from, (to ?? []).map(t => ({ to: t.to }))]))
      : undefined,
  };
}

/** Identities come with avatars, links and descriptors; the cache keeps the name and account. */
function slimIdentities(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([ref, value]) => {
      const identity = value as { displayName?: unknown; uniqueName?: unknown } | null;
      return typeof identity === 'object' && identity !== null && typeof identity.displayName === 'string'
        ? [ref, { displayName: identity.displayName, uniqueName: identity.uniqueName }]
        : [ref, value];
    }),
  );
}

/** The reads behind `azdev serve`'s cache: metadata, WIQL ids and items in batches. */
export class SyncService extends AzureDevOpsService implements SyncSource {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  public async fetchMeta(): Promise<RawMeta> {
    const project = this.config.project;
    const witApi = await this.getWorkItemTrackingApi();
    const workApi = await this.getWorkApi();
    const coreApi = await this.connection.getCoreApi();

    const [me, types, teamIterations, iterationRoot, areaRoot, tags, fields, members] = await Promise.all([
      this.currentIdentity(),
      witApi.getWorkItemTypes(project),
      workApi.getTeamIterations({ project }),
      witApi.getClassificationNode(project, ITERATIONS_GROUP, undefined, CLASSIFICATION_DEPTH),
      witApi.getClassificationNode(project, AREAS_GROUP, undefined, CLASSIFICATION_DEPTH),
      witApi.getTags(project),
      witApi.getFields(project),
      this.teamMembers(coreApi),
    ]);

    return {
      me,
      types: (types ?? []).map(toRawType),
      teamSprints: (teamIterations ?? []).map(it => ({
        id: it.id,
        name: it.name,
        path: it.path,
        startDate: iso(it.attributes?.startDate),
        finishDate: iso(it.attributes?.finishDate),
        timeframe: it.attributes?.timeFrame === undefined ? undefined : TIMEFRAMES[it.attributes.timeFrame],
      })),
      projectSprints: iterationRoot
        ? flattenIterations(iterationRoot).map(it => ({
            id: it.id,
            name: it.name,
            path: it.path,
            startDate: iso(it.startDate),
            finishDate: iso(it.finishDate),
          }))
        : [],
      members,
      tags: (tags ?? []).map(tag => tag.name).filter((name): name is string => Boolean(name)),
      areas: areaRoot ? flattenAreas(areaRoot).map(area => area.path).filter((path): path is string => Boolean(path)) : [],
      fieldRefs: (fields ?? []).map(field => field.referenceName).filter((ref): ref is string => Boolean(ref)),
    };
  }

  public runQuery(wiql: string, timePrecision?: boolean): Promise<number[]> {
    return this.queryIds(wiql, undefined, timePrecision);
  }

  public async fetchItems(ids: number[], fields: string[]): Promise<RawItem[]> {
    const witApi = await this.getWorkItemTrackingApi();
    const items: RawItem[] = [];
    // One batch at a time: the cache is a background reader and must not burst.
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
      const chunk = ids.slice(i, i + BATCH_LIMIT);
      const batch = await witApi.getWorkItems(chunk, fields, undefined, undefined, WorkItemErrorPolicy.Omit, this.config.project);
      for (const item of batch ?? []) {
        if (item?.id === undefined || item.rev === undefined) continue;
        items.push({ id: item.id, rev: item.rev, fields: slimIdentities(item.fields ?? {}) });
      }
    }
    return items;
  }

  private async teamMembers(coreApi: CoreApi): Promise<RawMeta['members']> {
    const teamId = (await coreApi.getProject(this.config.project))?.defaultTeam?.id;
    if (!teamId) return [];
    const members = await coreApi.getTeamMembersWithExtendedProperties(this.config.project, teamId);
    return (members ?? []).flatMap(member =>
      member.identity?.displayName ? [{ name: member.identity.displayName, email: member.identity.uniqueName }] : [],
    );
  }
}
