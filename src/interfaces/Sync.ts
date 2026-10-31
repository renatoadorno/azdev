/**
 * What the daemon's cache reads from Azure DevOps, before it becomes a Card or
 * Meta. Internal to azdev: SyncService produces it, src/serve consumes it.
 */

/** A work item as fetched: its revision and raw field values (identities stay objects). */
export interface RawItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
}

export interface Identity {
  id: string;
  name: string;
  email: string;
}

export interface RawState {
  name?: string;
  category?: string;
  color?: string;
}

export interface RawType {
  name?: string;
  color?: string;
  isDisabled?: boolean;
  states?: RawState[];
  /** From state → reachable states, as the API returns them. */
  transitions?: Record<string, Array<{ to?: string }>>;
}

export interface RawSprint {
  id?: string;
  name?: string;
  /** Field form: `Project\Sprint 82`. */
  path?: string;
  startDate?: string;
  finishDate?: string;
  /** Only team iterations have one. */
  timeframe?: 'past' | 'current' | 'future';
}

export interface RawMeta {
  me: Identity;
  types: RawType[];
  /** The default team's iterations, with timeframe. */
  teamSprints: RawSprint[];
  /** Every iteration of the project, for a sprint the team does not follow. */
  projectSprints: RawSprint[];
  members: Array<{ name: string; email?: string }>;
  tags: string[];
  areas: string[];
  /** Reference names of the project's fields — a card asks only for those that exist. */
  fieldRefs: string[];
}

/** The Azure DevOps reads the cache needs; faked in tests. */
export interface SyncSource {
  fetchMeta(): Promise<RawMeta>;
  /** WIQL → ids; `timePrecision` compares dates to the instant. */
  runQuery(wiql: string, timePrecision?: boolean): Promise<number[]>;
  /** Missing or unreadable ids are left out. */
  fetchItems(ids: number[], fields: string[]): Promise<RawItem[]>;
}
