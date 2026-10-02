import type { FlowCard } from './Flows';

/** Filters every stats command takes. */
export interface StatsFilters {
  mine?: boolean;
  /** E-mail or display name; `@me` is the authenticated user. */
  assignedTo?: string;
  types?: string[];
  /** Types left out (`--product` passes the operationalTypes of flows.json). */
  excludeTypes?: string[];
  teamId?: string;
}

/**
 * Interface for the progress of a sprint
 */
export interface SprintProgressParams extends StatsFilters {
  /** Sprint name, number, path, GUID or `current` (default). */
  sprint?: string;
  /** Add a day-by-day count of items and done items (one query per working day). */
  daily?: boolean;
}

/** Sprint moves that are part of the process, read from flows.json. */
export interface CarryoverRules {
  /** Waiting-list sprints (name or path): never counted as a sprint an item was carried from. */
  backlogSprints: string[];
  /** Cards whose sprint moves are expected (`expectedCarryover`): listed apart, not counted. */
  expected: FlowCard[];
}

/**
 * Interface for the items a sprint carried in from earlier sprints (and out to later ones)
 */
export interface SprintCarryoverParams extends StatsFilters {
  sprint?: string;
  /** How many earlier sprints to look back on. */
  lookback?: number;
  /** Only items not finished yet. */
  openOnly?: boolean;
  rules?: CarryoverRules;
}

/**
 * Interface for the progress of a story (its whole subtree)
 */
export interface StoryProgressParams {
  id: number;
}

/**
 * Interface for delivered items per sprint or per week
 */
export interface ThroughputParams extends StatsFilters {
  by: 'sprint' | 'week';
  /** How many sprints or weeks, the current one included. */
  last: number;
  /** Waiting-list sprints, never listed as delivery sprints. */
  backlogSprints?: string[];
}

/**
 * Interface for lead and cycle time of delivered items
 */
export interface CycleTimeParams extends StatsFilters {
  /** Items closed since: `90d` (default), `3m`, `YYYY-MM-DD`. */
  since?: string;
  /** Items of this sprint instead of a period. */
  sprint?: string;
  by?: 'type' | 'assignedTo' | 'none';
}

/**
 * Interface for open items by how long they have been waiting
 */
export interface AgingParams extends StatsFilters {
  sprint?: string;
  states?: string[];
  /** Only items already started (InProgress category): what is stuck. */
  inProgress?: boolean;
  /** Only items this many days or more in their current state. */
  minDays?: number;
  top?: number;
  /** Waiting-list sprints whose items are left out unless `includeParked`. */
  backlogSprints?: string[];
  includeParked?: boolean;
}
