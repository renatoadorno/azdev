/**
 * Interface for listing projects
 */
export interface ListProjectsParams {
  stateFilter?: 'all' | 'createPending' | 'deleted' | 'deleting' | 'new' | 'unchanged' | 'wellFormed';
  top?: number;
  skip?: number;
}

/**
 * Interface for getting project details
 */
export interface GetProjectDetailsParams {
  projectId: string;
  includeCapabilities?: boolean;
}

/**
 * Interface for creating a project
 */
export interface CreateProjectParams {
  name: string;
  description?: string;
  visibility?: 'private' | 'public';
  capabilities?: Record<string, any>;
}

/**
 * Interface for getting areas
 */
export interface GetAreasParams {
  projectId: string;
}

/**
 * Interface for getting iterations
 */
export interface GetIterationsParams {
  projectId: string;
}

/**
 * Interface for creating area
 */
export interface CreateAreaParams {
  projectId: string;
  name: string;
  parentPath?: string;
}

/**
 * Interface for creating iteration
 */
export interface CreateIterationParams {
  projectId: string;
  name: string;
  parentPath?: string;
  startDate?: string;
  finishDate?: string;
}

/**
 * Interface for getting processes
 */
export interface GetProcessesParams {
}

/**
 * Interface for getting work item types
 */
export interface GetWorkItemTypesParams {
  processId: string;
}

/**
 * Interface for getting work item type fields
 */
export interface GetWorkItemTypeFieldsParams {
  processId: string;
  witRefName: string;
} 