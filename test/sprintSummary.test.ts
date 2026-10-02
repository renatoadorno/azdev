import { describe, expect, it } from 'bun:test';
import { groupDelivery } from '../src/services/sprintSummary';

const card = (id: number, type: string, state: string, parent?: number, assignee = 'Renato') => ({
  id,
  WorkItemType: type,
  State: state,
  Title: `card ${id}`,
  AssignedTo: assignee,
  ...(parent ? { Parent: parent } : {}),
});

describe('groupDelivery', () => {
  const mine = [
    card(1, 'Task', 'Done', 100),
    card(2, 'technical tests', 'Done', 100),
    card(3, 'Task', 'In Progress', 200),
    card(4, 'Suporte produção', 'Done', 300),
    card(5, 'improvements', 'Done'),
    card(6, 'Task', 'Removed', 100),
  ];
  const parents = [card(100, 'Product Backlog Item', 'Done', undefined, 'Alice'), card(200, 'Product Backlog Item', 'New', undefined, 'Alice')];
  const siblings = [
    { ...card(7, 'Review', 'Done', 100, 'Bob'), Sprint: 'Sprint 82' },
    { ...card(8, 'Teste', 'Done', 100, 'Carol'), Sprint: 'Sprint 81' },
    { ...card(9, 'Task', 'Removed', 100, 'Bob'), Sprint: 'Sprint 81' },
  ];

  const delivery = groupDelivery({ mine, parents, siblings, operationalTypes: ['suporte produção'] });

  it('groups my cards by story and shows the rest of each cycle', () => {
    expect(delivery.stories.map(s => [s.story.id, s.inSprint.map(r => r.id), s.cycle.map(r => r.id)])).toEqual([
      [100, [1, 2], [7, 8]],
      [200, [3], []],
    ]);
  });

  it('keeps operational work apart, matching the type case-insensitively', () => {
    expect(delivery.operational.map(r => r.id)).toEqual([4]);
  });

  it('lists product cards with no parent as orphans', () => {
    expect(delivery.orphans.map(r => r.id)).toEqual([5]);
  });

  it('leaves Removed cards out of every group and count', () => {
    expect(delivery.totals).toEqual({
      cards: 5,
      done: 4,
      product: 4,
      operational: 1,
      stories: 2,
      byType: { Task: 2, 'technical tests': 1, 'Suporte produção': 1, improvements: 1 },
    });
  });

  it('drops the Parent column, which the grouping already says', () => {
    expect(delivery.stories[0]!.inSprint[0]).not.toHaveProperty('Parent');
    expect(delivery.stories[0]!.cycle[0]).not.toHaveProperty('Parent');
  });
});
