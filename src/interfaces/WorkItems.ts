/**
 * Interface for getting a work item by ID
 */
export interface WorkItemByIdParams {
  id: number;
  /** Restrict the returned fields (reference names, e.g. System.Title). */
  fields?: string[];
}

/** Rich-text format of multiline fields and comments. */
export type RichTextFormat = 'html' | 'markdown';

/**
 * A description template from the user's templates/ directory — a model to write
 * a card's description from, never the description itself.
 */
export interface DescriptionTemplate {
  /** File name without `.md` — a work item type (`Publication`) or a free name (`Publication [PROD]`). */
  name: string;
  content: string;
}

/**
 * Filters shared by every query that lists work items
 */
export interface WorkItemFilters {
  /** Only items assigned to the authenticated user. */
  mine?: boolean;
  /** Only items assigned to this user (display name or e-mail). Ignored when `mine` is set. */
  assignedTo?: string;
  /** Exact state. */
  state?: string;
  /** Exclude finished states (Done/Closed/Removed/Completed). */
  openOnly?: boolean;
  /** Exact work item type. */
  type?: string;
}

/**
 * Interface for listing children of a work item
 */
export interface ChildWorkItemsParams extends Omit<WorkItemFilters, 'assignedTo'> {
  id: number;
  /** Recurse the whole subtree instead of just direct children. */
  recursive?: boolean;
}

/**
 * Interface for the one-call context view of a work item
 */
export interface ViewWorkItemParams {
  id: number;
  /** How many of the latest comments to include. */
  comments?: number;
}

/**
 * Interface for reading the comments of a work item
 */
export interface ListCommentsParams {
  id: number;
  /** How many of the latest comments to return. */
  top?: number;
  /** Keep the stored HTML/Markdown instead of plain text. */
  raw?: boolean;
}

/**
 * Interface for listing (and downloading) the attachments of a work item
 */
export interface WorkItemAttachmentsParams {
  id: number;
  /** Directory to save every attachment into. */
  downloadDir?: string;
}

/**
 * Interface for getting the history of a work item
 */
export interface WorkItemHistoryParams {
  id: number;
}

/**
 * Interface for searching work items
 */
export interface SearchWorkItemsParams {
  searchText: string;
  top?: number;
}

/**
 * Interface for recently updated work items
 */
export interface RecentWorkItemsParams {
  top?: number;
  skip?: number;
}

/**
 * Interface for work items assigned to current user
 */
export interface MyWorkItemsParams {
  path?: string;
  /** Sprint name, number, `current` or path — resolved to an iteration path. */
  sprint?: string;
  state?: string;
  /** Exclude finished states (Done/Closed/Removed/Completed). */
  openOnly?: boolean;
  top?: number;
}

/**
 * Interface for creating a work item
 */
export interface CreateWorkItemParams {
  workItemType: string;
  title: string;
  description?: string;
  /** E-mail or display name; `@me` is the authenticated user. */
  assignedTo?: string;
  state?: string;
  areaPath?: string;
  iterationPath?: string;
  /** Sprint name, number, `current` or path — resolved to an iteration path. */
  sprint?: string;
  /** Parent work item; area and iteration are inherited from it when not given. */
  parentId?: number;
  /** `;`- or `,`-separated tags, or a list. */
  tags?: string | string[];
  additionalFields?: Record<string, any>;
  /** Rich-text format for multiline fields being set (e.g. System.Description). */
  format?: RichTextFormat;
  /**
   * Template the description must be written from: the create is refused when the
   * description is missing or still the untouched model, and warns on missing sections.
   */
  descriptionModel?: DescriptionTemplate;
}

/**
 * Interface for updating a work item
 */
export interface UpdateWorkItemParams {
  id: number;
  fields: Record<string, any>;
  /** Sprint name, number, `current` or path — resolved to System.IterationPath. */
  sprint?: string;
  /** Rich-text format for multiline fields being updated (e.g. System.Description). */
  format?: RichTextFormat;
}

/**
 * Interface for adding a comment to a work item
 */
export interface AddWorkItemCommentParams {
  id: number;
  text: string;
  /** Markdown keeps line breaks and `#id` links; HTML is the API default. */
  format?: RichTextFormat;
}

/**
 * Interface for updating a work item state
 */
export interface UpdateWorkItemStateParams {
  id: number;
  state: string;
  comment?: string;
}

/**
 * Interface for assigning a work item
 */
export interface AssignWorkItemParams {
  id: number;
  assignedTo: string;
}

/**
 * Interface for creating a link between work items
 */
export interface CreateLinkParams {
  sourceId: number;
  targetId: number;
  linkType: string;
  comment?: string;
}

/**
 * Interface for bulk operations on work items
 */
export interface BulkWorkItemParams {
  workItems: Array<CreateWorkItemParams | UpdateWorkItemParams>;
} 