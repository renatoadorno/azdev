import { WorkItemExpand } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { WorkItem, WorkItemRelation } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import type { ViewWorkItemParams, WorkItemAttachmentsParams } from '../interfaces/WorkItems';
import { WorkItemService } from './WorkItemService';
import {
  DEFAULT_HYDRATE_FIELDS,
  HIERARCHY_FORWARD,
  HIERARCHY_REVERSE,
  idFromWorkItemUrl,
  slimWorkItem,
} from './workItemUtils';
import { extractAttachmentUrls, parseAttachmentUrl, richTextToPlain, type AttachmentRef } from './richText';

const DESCRIPTION = 'System.Description';
const ACCEPTANCE_CRITERIA = 'Microsoft.VSTS.Common.AcceptanceCriteria';
const ATTACHED_FILE = 'AttachedFile';
const HYPERLINK = 'Hyperlink';
const ARTIFACT_LINK = 'ArtifactLink';

/** The page the comment API serves at most; attachments scan every comment it returns. */
const COMMENTS_SCAN_TOP = 200;

const VIEW_FIELDS = [
  'WorkItemType',
  'State',
  'Title',
  'AssignedTo',
  'IterationPath',
  'AreaPath',
  'Tags',
  'Priority',
  'BoardColumn',
  'CreatedBy',
  'CreatedDate',
  'ChangedDate',
];

export interface AttachmentEntry extends AttachmentRef {
  name: string;
  url: string;
  /** Where it was found: attached to the item, or inline in a rich-text field/comment. */
  source: 'attached' | 'description' | 'acceptanceCriteria' | 'comment';
}

interface RelationGroups {
  parentId?: number;
  childIds: number[];
  linked: Array<{ rel: string; id: number }>;
  attached: Array<{ name: string; url: string }>;
  hyperlinks: string[];
  artifacts: Array<{ name: string; url: string }>;
}

function groupRelations(relations: WorkItemRelation[]): RelationGroups {
  const groups: RelationGroups = { childIds: [], linked: [], attached: [], hyperlinks: [], artifacts: [] };
  for (const relation of relations) {
    const name = relation.attributes?.name ?? relation.rel ?? '';
    const url = relation.url ?? '';
    if (relation.rel === HIERARCHY_REVERSE) groups.parentId = idFromWorkItemUrl(url);
    else if (relation.rel === HIERARCHY_FORWARD) {
      const id = idFromWorkItemUrl(url);
      if (id) groups.childIds.push(id);
    } else if (relation.rel === ATTACHED_FILE) groups.attached.push({ name, url });
    else if (relation.rel === HYPERLINK) groups.hyperlinks.push(url);
    else if (relation.rel === ARTIFACT_LINK) groups.artifacts.push({ name, url });
    else {
      const id = idFromWorkItemUrl(url);
      if (id) groups.linked.push({ rel: name, id });
    }
  }
  return groups;
}

/** Drops undefined values and empty arrays so the view only shows what exists. */
function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)),
  );
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

export class WorkItemViewService extends WorkItemService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  private async getWithRelations(id: number): Promise<WorkItem> {
    const witApi = await this.getWorkItemTrackingApi();
    const workItem = await witApi.getWorkItem(id, undefined, undefined, WorkItemExpand.Relations, this.config.project);
    if (!workItem) throw new Error(`Work item ${id} not found`);
    return workItem;
  }

  /** Readable text of a rich-text field, honouring the format the item stores it in. */
  private fieldText(workItem: WorkItem, ref: string): string | undefined {
    const formats = (workItem as { multilineFieldsFormat?: Record<string, string> }).multilineFieldsFormat ?? {};
    return richTextToPlain(workItem.fields?.[ref], formats[ref]);
  }

  /**
   * Everything needed to understand a card in one call: its fields, the
   * description as text, parent, children, links, recent comments and images.
   */
  public async viewWorkItem(params: ViewWorkItemParams): Promise<Record<string, unknown>> {
    const workItem = await this.getWithRelations(params.id);
    const relations = groupRelations(workItem.relations ?? []);

    const relatedIds = [
      ...new Set([relations.parentId, ...relations.childIds, ...relations.linked.map(l => l.id)]),
    ].filter((id): id is number => typeof id === 'number');
    const rows = await this.hydrate(relatedIds, DEFAULT_HYDRATE_FIELDS);
    const byId = new Map(rows.map(row => [row.id as number, row]));
    const brief = (id: number) => {
      const { Parent: _parent, ...row } = byId.get(id) ?? { id };
      return row;
    };

    const commentCount = params.comments ?? 5;
    const comments = commentCount > 0 ? await this.getComments({ id: params.id, top: commentCount }) : undefined;

    const description = this.fieldText(workItem, DESCRIPTION);
    const acceptanceCriteria = this.fieldText(workItem, ACCEPTANCE_CRITERIA);
    const images = [
      ...extractAttachmentUrls(description),
      ...extractAttachmentUrls(acceptanceCriteria),
      ...(comments?.comments ?? []).flatMap(c => extractAttachmentUrls(c.text)),
    ];

    return compact({
      ...slimWorkItem(workItem, VIEW_FIELDS),
      url: this.webUrl(params.id),
      parent: relations.parentId ? brief(relations.parentId) : undefined,
      description,
      acceptanceCriteria,
      children: relations.childIds
        .map(brief)
        .sort((a, b) => String(a.WorkItemType).localeCompare(String(b.WorkItemType)) || (a.id ?? 0) - (b.id ?? 0)),
      links: relations.linked.map(link => ({ link: link.rel, ...brief(link.id) })),
      artifacts: relations.artifacts,
      hyperlinks: relations.hyperlinks,
      attachments: relations.attached,
      images: [...new Set(images)],
      comments: comments && comments.total > 0
        ? { total: comments.total, shown: comments.comments.length, items: comments.comments }
        : undefined,
    });
  }

  /** Attached files plus images embedded in the description, acceptance criteria and comments. */
  public async listAttachments(params: WorkItemAttachmentsParams): Promise<AttachmentEntry[]> {
    const workItem = await this.getWithRelations(params.id);
    const { comments } = await this.getComments({ id: params.id, top: COMMENTS_SCAN_TOP, raw: true });

    const found: Array<{ url: string; name?: string; source: AttachmentEntry['source'] }> = [
      ...groupRelations(workItem.relations ?? []).attached.map(a => ({ ...a, source: 'attached' as const })),
      ...extractAttachmentUrls(workItem.fields?.[DESCRIPTION]).map(url => ({ url, source: 'description' as const })),
      ...extractAttachmentUrls(workItem.fields?.[ACCEPTANCE_CRITERIA]).map(url => ({ url, source: 'acceptanceCriteria' as const })),
      ...comments.flatMap(c => extractAttachmentUrls(c.text).map(url => ({ url, source: 'comment' as const }))),
    ];

    const entries = new Map<string, AttachmentEntry>();
    for (const item of found) {
      const ref = parseAttachmentUrl(item.url);
      if (!ref || entries.has(ref.id)) continue;
      const fileName = ref.fileName ?? item.name;
      entries.set(ref.id, { ...ref, fileName, name: fileName ?? ref.id, url: item.url, source: item.source });
    }
    return [...entries.values()];
  }

  /** Attachment bytes, fetched with the configured credential. */
  public async downloadAttachment(ref: AttachmentRef): Promise<Buffer> {
    const witApi = await this.getWorkItemTrackingApi();
    const stream = await witApi.getAttachmentContent(ref.id, ref.fileName, this.config.project, true);
    // The SDK hands back the raw response without checking it: a 404 body would be saved as the file.
    const statusCode = (stream as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400) {
      throw Object.assign(new Error(`Could not download attachment ${ref.id}`), { statusCode });
    }
    return readStream(stream);
  }
}
