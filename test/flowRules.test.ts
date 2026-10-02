import { describe, expect, it } from 'bun:test';
import type { FlowDefinition, FlowsFile } from '../src/interfaces/Flows';
import {
  applicableFlows,
  closedAt,
  evaluateFlow,
  expectedCarryoverCards,
  fitsAnyCard,
  matchCards,
  pickFlow,
  planFlow,
  renderTemplate,
  startingDescription,
  validateFlows,
} from '../src/services/flowRules';

const TESTS_TEMPLATE = '## O que foi testado\n\n## Resultado\n';

const STORY: FlowDefinition = {
  parentTypes: ['Product Backlog Item'],
  cards: [
    { key: 'impl', type: 'Task', title: 'Implementação: {title}' },
    {
      key: 'tests',
      type: 'technical tests',
      title: 'Testes técnicos: {title}',
      requireDescription: true,
      retestAfter: ['Task', 'Issue'],
      description: TESTS_TEMPLATE,
    },
    { key: 'review', type: 'Review', title: 'Code review: {title}' },
    { key: 'pub-hml', type: 'Publication', title: '{title} [HOMOLOG]', match: '\\[\\s*HOMOLOG\\s*\\]', optional: true },
    { key: 'pub-prod', type: 'Publication', title: '{title} [PROD]', match: '\\[\\s*PROD\\s*\\]' },
  ],
};

const FILE: FlowsFile = { flows: { story: STORY } };
const CTX = { title: 'Carrinho', id: 13298 };

function row(id: number, type: string, title: string, state = 'Done', extra: Record<string, unknown> = {}) {
  return { id, WorkItemType: type, Title: title, State: state, AssignedTo: 'Renato', ...extra };
}

describe('renderTemplate', () => {
  it('fills {title} and {id} and leaves anything else alone', () => {
    expect(renderTemplate('{title} #{id} {other}', CTX)).toBe('Carrinho #13298 {other}');
  });
});

describe('validateFlows', () => {
  it('accepts a well-formed file', () => {
    expect(validateFlows(FILE)).toBe(FILE);
  });

  it('rejects a file without a flows map', () => {
    expect(() => validateFlows({ cards: [] })).toThrow('"flows" map');
  });

  it('lists every problem at once', () => {
    const bad = {
      flows: {
        a: { cards: [{ key: 'x', type: 'Task' }, { key: 'x', type: 'Task', title: 'T', match: '([' }] },
        b: { cards: [] },
      },
    };
    let message = '';
    try {
      validateFlows(bad);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('"title" is required');
    expect(message).toContain('duplicate card key "x"');
    expect(message).toContain('not a valid regex');
    expect(message).toContain('flow "b": "cards" must be a non-empty list');
  });

  it('rejects two cards of the same type that a title cannot tell apart', () => {
    const flows = { flows: { s: { cards: [
      { key: 'qa-hml', type: 'Teste', title: 'QA homolog {title}' },
      { key: 'qa-prod', type: 'Teste', title: 'QA prod {title}' },
    ] } } };
    expect(() => validateFlows(flows)).toThrow('would count as card "qa-hml"');
  });

  it('lists the problems instead of crashing when an invalid card precedes a valid one', () => {
    const noType = { flows: { s: { cards: [{ key: 'a', title: 'A' }, { key: 'b', type: 'Task', title: 'B' }] } } };
    expect(() => validateFlows(noType)).toThrow('card "a": "type" is required');

    const badRegex = { flows: { s: { cards: [
      { key: 'a', type: 'Task', title: 'A', match: '([' },
      { key: 'b', type: 'Task', title: 'B' },
    ] } } };
    expect(() => validateFlows(badRegex)).toThrow('"match" is not a valid regex');
  });

  it('rejects a card whose own title fails its match, which would make apply create it forever', () => {
    const flows = { flows: { s: { cards: [{ key: 'pub', type: 'Publication', title: '{title}', match: '\\[PROD\\]' }] } } };
    expect(() => validateFlows(flows)).toThrow('does not match its own "match"');
  });

  it('checks the carry-over settings', () => {
    const ok = { backlogSprints: ['Sprint 100'], flows: { s: { cards: [{ key: 'pub', type: 'Publication', title: '{title} [PROD]', expectedCarryover: true }] } } };
    expect(validateFlows(ok)).toBe(ok as any);
    expect(() => validateFlows({ ...ok, backlogSprints: 'Sprint 100' })).toThrow('"backlogSprints" must be a list of sprint names or paths');
    expect(() => validateFlows({ flows: { s: { cards: [{ key: 'pub', type: 'Publication', title: 'P', expectedCarryover: 'yes' }] } } }))
      .toThrow('"expectedCarryover" must be true or false');
  });
});

describe('carry-over cards', () => {
  it('collects the cards whose sprint moves are expected and matches items against them', () => {
    const cards = expectedCarryoverCards({ flows: { s: { cards: [
      { key: 'impl', type: 'Task', title: 'Impl {title}' },
      { key: 'pub', type: 'Publication', title: '{title} [PROD]', match: '\\[\\s*PROD\\s*\\]', expectedCarryover: true },
    ] } } });
    expect(cards.map(c => c.key)).toEqual(['pub']);
    expect(fitsAnyCard(cards, row(1, 'Publication', 'Deploy [ PROD]'))).toBe(true);
    expect(fitsAnyCard(cards, row(2, 'Publication', 'Deploy [HOMOLOG]'))).toBe(false);
    expect(expectedCarryoverCards(null)).toEqual([]);
  });
});

describe('pickFlow', () => {
  it('picks the flow whose parentTypes include the story type, case-insensitive', () => {
    expect(pickFlow(FILE, 'product backlog item')[0]).toBe('story');
  });

  it('honours an explicit name and rejects an unknown one', () => {
    expect(pickFlow(FILE, 'Bug', 'story')[0]).toBe('story');
    expect(() => pickFlow(FILE, 'Bug', 'nope')).toThrow('Flow "nope" not found. Defined: story');
  });

  it('lists the flows that apply to a type', () => {
    expect(applicableFlows({ flows: { a: STORY, b: { cards: STORY.cards } } }, 'Product Backlog Item')).toEqual(['a']);
  });

  it('asks for a name when no flow or several flows apply', () => {
    expect(() => pickFlow(FILE, 'Bug Fix')).toThrow('No flow applies to "Bug Fix"');
    const twice = { flows: { a: STORY, b: STORY } };
    expect(() => pickFlow(twice, 'Product Backlog Item')).toThrow('Several flows apply');
  });
});

describe('matchCards', () => {
  it('sends each child to the first card it fits and leaves the rest unmatched', () => {
    const { matches, unmatched } = matchCards(STORY.cards, [
      row(1, 'Task', 'Implementar'),
      row(2, 'Publication', 'Carrinho [ PROD]'),
      row(3, 'Publication', 'Carrinho [HOMOLOG]'),
      row(4, 'Reports', 'Comunicar publicação'),
    ]);
    const ids = Object.fromEntries(matches.map(m => [m.card.key, m.items.map(i => i.id)]));
    expect(ids).toEqual({ impl: [1], tests: [], review: [], 'pub-hml': [3], 'pub-prod': [2] });
    expect(unmatched.map(u => u.id)).toEqual([4]);
  });

  it('treats a Removed card as absent', () => {
    const { matches, unmatched } = matchCards(STORY.cards, [row(1, 'Task', 'Remover webhook', 'Removed')]);
    expect(matches[0]!.items).toEqual([]);
    expect(unmatched).toEqual([]);
  });
});

describe('closedAt', () => {
  it('uses ClosedDate, falls back to StateChangeDate, and is empty while open', () => {
    expect(closedAt(row(1, 'Task', 't', 'Done', { ClosedDate: '2026-09-10T12:00:00Z' }))).toBe('2026-09-10T12:00:00.000Z');
    expect(closedAt(row(1, 'Reports', 't', 'Done', { StateChangeDate: '2026-09-11T00:00:00Z' }))).toBe('2026-09-11T00:00:00.000Z');
    expect(closedAt(row(1, 'Task', 't', 'In Progress', { StateChangeDate: '2026-09-11T00:00:00Z' }))).toBeUndefined();
  });
});

describe('evaluateFlow', () => {
  const complete = [
    row(10, 'Task', 'Implementar', 'Done', { ClosedDate: '2026-09-08T00:00:00Z' }),
    row(11, 'technical tests', 'Testes', 'Done', { ClosedDate: '2026-09-10T00:00:00Z', Description: 'Suíte X verde' }),
    row(12, 'Review', 'Code review'),
    row(13, 'Publication', 'Carrinho [PROD]'),
  ];

  it('reports a complete cycle with no findings, the optional card skipped', () => {
    const { cards, findings } = evaluateFlow(STORY, complete);
    expect(findings).toEqual([]);
    expect(cards.map(c => [c.key, c.status])).toEqual([
      ['impl', 'done'],
      ['tests', 'done'],
      ['review', 'done'],
      ['pub-hml', 'skipped'],
      ['pub-prod', 'done'],
    ]);
  });

  it('flags a missing required card', () => {
    const { cards, findings } = evaluateFlow(STORY, complete.filter(r => r.id !== 11));
    expect(cards.find(c => c.key === 'tests')!.status).toBe('missing');
    expect(findings).toEqual(['tests: missing technical tests card']);
  });

  it('points at a publication whose title hides the [PROD] marker', () => {
    const children = [...complete.filter(r => r.id !== 13), row(14, 'Publication', 'Publicação - Code review')];
    const { findings, others } = evaluateFlow(STORY, children);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('pub-prod: missing Publication card — #14 "Publicação - Code review" is a Publication');
    expect(others.map(o => o.id)).toEqual([14]);
  });

  it('marks a card open while any of its items is open', () => {
    const children = [...complete, row(15, 'Task', 'Ajuste', 'In Progress')];
    expect(evaluateFlow(STORY, children).cards[0]).toMatchObject({ status: 'open', ids: '10,15', state: 'Done, In Progress' });
  });

  it('flags a tests card with no description', () => {
    const children = complete.map(r => (r.id === 11 ? { ...r, Description: '<div><br></div>&nbsp;' } : r));
    expect(evaluateFlow(STORY, children).findings).toEqual([
      'tests: #11 has no description beyond the template — record what was done or tested, how, and the result',
    ]);
  });

  it('flags a tests card still holding the untouched template apply created it with', () => {
    const children = complete.map(r => (r.id === 11 ? { ...r, Description: '## O que foi testado\n\n## Resultado' } : r));
    expect(evaluateFlow(STORY, children, new Map(), CTX).findings).toHaveLength(1);
  });

  it('recognizes an untouched template file, filled with the card title and the story', () => {
    const flow: FlowDefinition = { cards: [{ key: 'tests', type: 'technical tests', title: 'T', requireDescription: true }] };
    const templates = [{ name: 'technical tests', content: '# Testes: {title} (#{parentId})\n\n## Resultado\n' }];
    const untouched = [row(11, 'technical tests', 'Testes do carrinho', 'Done', { Description: '# Testes: Testes do carrinho (#13298)\n## Resultado' })];
    const written = [row(11, 'technical tests', 'Testes do carrinho', 'Done', { Description: '# Testes: Testes do carrinho (#13298)\n## Resultado\nverde' })];
    expect(evaluateFlow(flow, untouched, new Map(), CTX, templates).findings).toHaveLength(1);
    expect(evaluateFlow(flow, written, new Map(), CTX, templates).findings).toEqual([]);
  });

  it('prefers the card inline description over its template file as the model', () => {
    const card = { key: 'tests', type: 'technical tests', title: 'T', description: '## Inline {title}' };
    const templates = [{ name: 'technical tests', content: '## Arquivo' }];
    expect(startingDescription(card, row(1, 'technical tests', 'X'), CTX, templates)).toBe('## Inline Carrinho');
    expect(startingDescription({ ...card, description: undefined, template: 'technical tests' }, row(1, 'technical tests', 'X'), CTX, templates)).toBe('## Arquivo');
  });

  it('recognizes an untouched template with <placeholders>, which storage keeps entity-encoded', () => {
    const flow: FlowDefinition = {
      cards: [{ key: 'tests', type: 'technical tests', title: 'T', requireDescription: true, description: '## Resultado\n<descreva>\n' }],
    };
    const stored = [row(11, 'technical tests', 'T', 'Done', { Description: '## Resultado\n&lt;descreva&gt;' })];
    expect(evaluateFlow(flow, stored, new Map(), CTX).findings).toHaveLength(1);
  });

  describe('retest after a later fix', () => {
    const fixAfterTests = [...complete, row(16, 'Issue', 'Fix do code review', 'Done', { ClosedDate: '2026-09-16T00:00:00Z' })];

    it('flags tests closed before a fix closed', () => {
      expect(evaluateFlow(STORY, fixAfterTests).findings).toEqual([
        'tests: #11 closed 2026-09-10, but #16 (Issue) closed 2026-09-16 after it — record a retest (comment or new card)',
      ]);
    });

    it('accepts a comment on the tests card after the fix as the retest record', () => {
      const comments = new Map([[11, '2026-09-17T09:00:00.000Z']]);
      expect(evaluateFlow(STORY, fixAfterTests, comments).findings).toEqual([]);
    });

    it('accepts a second tests card closed after the fix', () => {
      const retested = [...fixAfterTests, row(17, 'technical tests', 'Reteste', 'Done', { ClosedDate: '2026-09-17T00:00:00Z', Description: 'ok' })];
      expect(evaluateFlow(STORY, retested).findings).toEqual([]);
    });

    it('ignores a removed fix and fixes of types outside retestAfter', () => {
      const ignored = [
        ...complete,
        row(18, 'Issue', 'Descartada', 'Removed', { StateChangeDate: '2026-09-20T00:00:00Z' }),
        row(19, 'Reports', 'Comunicar', 'Done', { StateChangeDate: '2026-09-20T00:00:00Z' }),
      ];
      expect(evaluateFlow(STORY, ignored).findings).toEqual([]);
    });

    it('does not judge tests that are still running', () => {
      const running = fixAfterTests.map(r => (r.id === 11 ? { ...r, State: 'Committed' } : r));
      expect(evaluateFlow(STORY, running).findings).toEqual([]);
    });
  });
});

describe('planFlow', () => {
  const children = [row(10, 'Task', 'Implementar'), row(12, 'Review', 'Code review')];
  const actions = (plan: ReturnType<typeof planFlow>) => Object.fromEntries(plan.map(p => [p.card.key, p.action]));

  it('creates every required card the story lacks and leaves optional ones out', () => {
    const plan = planFlow(STORY, children, CTX);
    expect(actions(plan)).toEqual({ impl: 'exists', tests: 'create', review: 'exists', 'pub-hml': 'skipped', 'pub-prod': 'create' });
    expect(plan.find(p => p.card.key === 'pub-prod')!.title).toBe('Carrinho [PROD]');
    expect(plan.find(p => p.card.key === 'impl')).toMatchObject({ ids: '10', title: 'Implementar' });
  });

  it('creates an optional card when asked with "with"', () => {
    expect(actions(planFlow(STORY, children, CTX, { with: ['pub-hml'] }))['pub-hml']).toBe('create');
  });

  it('restricts to "only", optional cards included', () => {
    expect(actions(planFlow(STORY, children, CTX, { only: ['pub-hml'] }))).toEqual({
      impl: 'exists', tests: 'skipped', review: 'exists', 'pub-hml': 'create', 'pub-prod': 'skipped',
    });
  });

  it('honours skip', () => {
    expect(actions(planFlow(STORY, children, CTX, { skip: ['tests'] })).tests).toBe('skipped');
  });

  it('is idempotent: a story with every card plans nothing', () => {
    const full = [
      ...children,
      row(11, 'technical tests', 'Testes'),
      row(13, 'Publication', 'Carrinho [PROD]'),
    ];
    expect(planFlow(STORY, full, CTX).filter(p => p.action === 'create')).toEqual([]);
  });

  it('refuses to create a card whose real title another card would claim', () => {
    const plan = planFlow(STORY, children, { title: 'Erro no checkout [HOMOLOG]', id: 1 });
    const prod = plan.find(p => p.card.key === 'pub-prod')!;
    expect(prod.action).toBe('conflict');
    expect(prod.reason).toContain('would count as card "pub-hml"');
  });

  it('rejects an unknown card key before anything is created', () => {
    expect(() => planFlow(STORY, children, CTX, { skip: ['qa'] })).toThrow('Unknown card key(s): qa');
  });

  describe('titles', () => {
    it('gives a card its whole title by key, placeholders included', () => {
      const plan = planFlow(STORY, children, CTX, { titles: { 'pub-prod': 'Publicar API + app #{id} [PROD]' } });
      expect(plan.find(p => p.card.key === 'pub-prod')).toMatchObject({ action: 'create', title: 'Publicar API + app #13298 [PROD]' });
      expect(plan.find(p => p.card.key === 'tests')!.title).toBe('Testes técnicos: Carrinho');
    });

    it('still refuses a title that would not count as the card on the next run', () => {
      const prod = planFlow(STORY, children, CTX, { titles: { 'pub-prod': 'Publicar API' } }).find(p => p.card.key === 'pub-prod')!;
      expect(prod.action).toBe('conflict');
      expect(prod.reason).toContain(`does not match the card's own "match"`);
    });

    it('rejects a title for an unknown key or an empty one', () => {
      expect(() => planFlow(STORY, children, CTX, { titles: { qa: 'Testes' } })).toThrow('Unknown card key(s): qa');
      expect(() => planFlow(STORY, children, CTX, { titles: { tests: '  ' } })).toThrow('Empty title for card(s): tests');
    });
  });
});
