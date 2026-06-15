/**
 * Interface for getting a work item by ID
 */
export interface WorkItemByIdParams {
  id: number;
  /** Restrict the returned fields (reference names, e.g. System.Title). */
  fields?: string[];
}

/**
 * Interface for listing children of a work item
 */
export interface ChildWorkItemsParams {
  id: number;
  /** Recurse the whole subtree instead of just direct children. */
  recursive?: boolean;
  /** Only children assigned to the current user. */
  mine?: boolean;
  /** Exact state filter. */
  state?: string;
  /** Exclude finished states (Done/Closed/Removed/Completed). */
  openOnly?: boolean;
  /** Work item type filter (e.g. Task, Bug). */
  type?: string;
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
  path: string;
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
  assignedTo?: string;
  state?: string;
  areaPath?: string;
  iterationPath?: string;
  additionalFields?: Record<string, any>;
  /** Rich-text format for multiline fields being set (e.g. System.Description). */
  format?: 'html' | 'markdown';
}

/**
 * Interface for updating a work item
 */
export interface UpdateWorkItemParams {
  id: number;
  fields: Record<string, any>;
  /** Rich-text format for multiline fields being updated (e.g. System.Description). */
  format?: 'html' | 'markdown';
}

/**
 * Interface for adding a comment to a work item
 */
export interface AddWorkItemCommentParams {
  id: number;
  text: string;
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