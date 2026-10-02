import type { WorkItemFilters } from './WorkItems';

/**
 * Interface for getting boards
 */
export interface GetBoardsParams {
  teamId?: string;
}

/**
 * Interface for getting board columns
 */
export interface GetBoardColumnsParams {
  teamId?: string;
  boardId: string;
}

/**
 * Interface for getting board items
 */
export interface GetBoardItemsParams {
  teamId?: string;
  boardId: string;
}

/**
 * Interface for moving a card on board
 */
export interface MoveCardOnBoardParams {
  teamId?: string;
  boardId: string;
  workItemId: number;
  columnId: string;
  position?: number;
}

/**
 * Interface for getting sprints
 */
export interface GetSprintsParams {
  teamId?: string;
}

/**
 * Interface for getting current sprint
 */
export interface GetCurrentSprintParams {
  teamId?: string;
}

/**
 * Interface for getting sprint work items
 */
export interface GetSprintWorkItemsParams extends WorkItemFilters {
  teamId?: string;
  /** Sprint name, number, path, GUID or `current` (default). */
  sprint?: string;
}

/**
 * Interface for the per-person delivery summary of a sprint
 */
export interface SprintSummaryParams {
  teamId?: string;
  /** Sprint name, number, path, GUID or `current` (default). */
  sprint?: string;
  /** Whose delivery to summarize (e-mail or display name); defaults to the authenticated user. */
  assignedTo?: string;
  /** Types kept apart from product work (support, meetings, hot fixes). */
  operationalTypes?: string[];
}

/**
 * Interface for getting sprint capacity
 */
export interface GetSprintCapacityParams {
  teamId?: string;
  /** Sprint name, number, path, GUID or `current` (default). */
  sprint?: string;
}

/**
 * Interface for getting team members
 */
export interface GetTeamMembersParams {
  teamId?: string;
} 