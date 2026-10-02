/**
 * A card of a flow: one child work item the story is expected to have.
 * `title`, `description` take the placeholders `{title}` and `{id}` (the parent's).
 */
export interface FlowCard {
  key: string;
  type: string;
  title: string;
  /** Case-insensitive regex an existing child's title must match to count as this card. Default: any child of `type`. */
  match?: string;
  /** E-mail or display name; `@me` is the authenticated user. */
  assignedTo?: string;
  state?: string;
  /** Sprint for the created card (name, number, `current`); default: the parent's. */
  sprint?: string;
  tags?: string;
  /** Markdown template for the description. */
  description?: string;
  /** Missing is not flagged by `flow status`, and `flow apply` creates it only on request (`--with`). */
  optional?: boolean;
  /** Flag the card when its description is empty. */
  requireDescription?: boolean;
  /** Types whose closing after this card makes it stale (e.g. a fix landing after the tests). */
  retestAfter?: string[];
}

export interface FlowDefinition {
  description?: string;
  /** Parent types this flow applies to — lets `flow status`/`apply` pick it automatically. */
  parentTypes?: string[];
  cards: FlowCard[];
}

export interface FlowsFile {
  /** Types `sprint summary` keeps apart from product work (support, meetings, hot fixes). */
  operationalTypes?: string[];
  flows: Record<string, FlowDefinition>;
}

export interface FlowStatusParams {
  parentId: number;
  flow?: string;
}

export interface SprintFlowStatusParams {
  sprint: string;
  /** Audit every story with this flow instead of picking one per story type. */
  flow?: string;
  /** Only stories that hold one of my cards in the sprint. */
  mine?: boolean;
  teamId?: string;
}

export interface ApplyFlowParams {
  parentId: number;
  flow?: string;
  /** Only these card keys. */
  only?: string[];
  /** Every card except these keys. */
  skip?: string[];
  /** Optional cards to create too — they are left out by default. */
  with?: string[];
  /** Sprint for every created card, overriding the cards' own and the parent's. */
  sprint?: string;
  dryRun?: boolean;
}
