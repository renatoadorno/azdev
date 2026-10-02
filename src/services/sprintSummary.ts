/**
 * Delivery of one person in a sprint, grouped by the story (parent) each card
 * belongs to. Counting cards per assignee misreads delivery both ways: review,
 * QA and publication cards of a story often sit with other people, while
 * operational queues (support, meetings, hot fixes) inflate raw counts.
 */

import { REMOVED_STATE, isClosedState, type WorkItemRow as Row } from './workItemUtils';

export interface DeliveryInput {
  /** The person's cards in the sprint (hydrated with Parent). */
  mine: Row[];
  /** Parents of those cards. */
  parents: Row[];
  /** Every other child of those parents, any assignee, any sprint (hydrated with Parent). */
  siblings: Row[];
  operationalTypes?: string[];
}

export interface StoryDelivery {
  story: Row;
  /** The person's cards of this story in the sprint. */
  inSprint: Row[];
  /** The rest of the story's cycle: other people's cards and other sprints. */
  cycle: Row[];
}

export interface Delivery {
  totals: {
    cards: number;
    done: number;
    product: number;
    operational: number;
    stories: number;
    byType: Record<string, number>;
  };
  stories: StoryDelivery[];
  /** Product cards with no parent — work that no story accounts for. */
  orphans: Row[];
  operational: Row[];
}

function withoutParent({ Parent: _parent, ...row }: Row): Row {
  return row;
}

function countBy(rows: Row[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row[key] ?? '');
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export function groupDelivery(input: DeliveryInput): Delivery {
  const operationalTypes = new Set((input.operationalTypes ?? []).map(t => t.toLowerCase()));
  const isOperational = (row: Row) => operationalTypes.has(String(row.WorkItemType ?? '').toLowerCase());

  const mine = input.mine.filter(row => row.State !== REMOVED_STATE);
  const product = mine.filter(row => !isOperational(row));
  const operational = mine.filter(isOperational);
  const mineIds = new Set(mine.map(row => row.id));

  const stories = input.parents.map(story => ({
    story: withoutParent(story),
    inSprint: product.filter(row => row.Parent === story.id).map(withoutParent),
    cycle: input.siblings
      .filter(row => row.Parent === story.id && !mineIds.has(row.id) && row.State !== REMOVED_STATE)
      .map(withoutParent),
  }));

  const parentIds = new Set(input.parents.map(p => p.id));
  const orphans = product.filter(row => typeof row.Parent !== 'number' || !parentIds.has(row.Parent)).map(withoutParent);

  return {
    totals: {
      cards: mine.length,
      done: mine.filter(row => isClosedState(row.State)).length,
      product: product.length,
      operational: operational.length,
      stories: stories.length,
      byType: countBy(mine, 'WorkItemType'),
    },
    stories,
    orphans,
    operational: operational.map(withoutParent),
  };
}
