import { describe, expect, it } from 'bun:test';
import type { FlowsFile } from '../src/interfaces/Flows';
import { FlowService } from '../src/services/FlowService';

const ORG = 'https://dev.azure.com/acme';

const FLOWS: FlowsFile = {
  flows: {
    story: {
      parentTypes: ['Product Backlog Item'],
      cards: [
        { key: 'tests', type: 'technical tests', title: 'Testes: {title}', assignedTo: '@me' },
        { key: 'pub', type: 'Publication', title: '{title} [PROD]', match: '\\[PROD\\]', assignedTo: '@me' },
      ],
    },
  },
};

const TEMPLATES = [
  { name: 'technical tests', content: '## O que foi testado\n\n## Resultado\n' },
  { name: 'Publication', content: '## PRs\n\n## Janela\n' },
];

const WRITTEN = {
  tests: '## O que foi testado\nCarrinho editável\n\n## Resultado\nverde',
  pub: '## PRs\n- api: https://x/pr/1\n\n## Janela\n1. api',
};

/** A FlowService over a story (#100) with no children, recording every create. */
function makeService() {
  const creates: Array<{ type: string; ops: Array<{ path?: string; value?: unknown }> }> = [];
  const story = { id: 100, fields: { 'System.WorkItemType': 'Product Backlog Item', 'System.Title': 'Carrinho', 'System.State': 'New' } };
  const witApi = {
    getWorkItems: async (ids: number[]) => ids.map(id => (id === 100 ? story : null)),
    queryByWiql: async () => ({ workItems: [] }),
    getWorkItem: async () => ({ id: 100, fields: { 'System.AreaPath': 'Demo', 'System.IterationPath': 'Demo\\Sprint 82', 'System.Title': 'Carrinho' } }),
    createWorkItem: async (_h: unknown, ops: Array<{ path?: string; value?: unknown }>, _p: string, type: string) => {
      creates.push({ type, ops });
      return { id: 200 + creates.length, fields: { 'System.WorkItemType': type, 'System.Title': ops.find(o => o.path === '/fields/System.Title')?.value } };
    },
  };
  const svc = new FlowService({ orgUrl: ORG, project: 'Demo', personalAccessToken: 'tok', auth: { type: 'pat' } });
  (svc as any).connection = {
    getWorkItemTrackingApi: async () => witApi,
    connect: async () => ({ authenticatedUser: { properties: { Account: { $value: 'me@acme.dev' } } } }),
  };
  return { svc, creates };
}

describe('FlowService.applyFlow with templates', () => {
  it('creates nothing when a card with a template has no written description', async () => {
    const { svc, creates } = makeService();
    await expect(svc.applyFlow(FLOWS, { parentId: 100, descriptions: { tests: WRITTEN.tests } }, TEMPLATES))
      .rejects.toThrow("Write each card's description from its template and pass them with --descriptions <dir> (<key>.md): pub (Publication)");
    expect(creates).toEqual([]);
  });

  it('creates every card with the description written for it', async () => {
    const { svc, creates } = makeService();
    const result = await svc.applyFlow(FLOWS, { parentId: 100, descriptions: WRITTEN }, TEMPLATES);
    expect(creates.map(c => [c.type, c.ops.find(o => o.path === '/fields/System.Description')?.value])).toEqual([
      ['technical tests', WRITTEN.tests],
      ['Publication', WRITTEN.pub],
    ]);
    expect((result.cards as any[]).map(c => [c.key, c.action, c.template, c.description])).toEqual([
      ['tests', 'created', 'technical tests', 'provided'],
      ['pub', 'created', 'Publication', 'provided'],
    ]);
  });

  it('refuses an untouched template passed as the description, before creating anything', async () => {
    const { svc, creates } = makeService();
    await expect(svc.applyFlow(FLOWS, { parentId: 100, descriptions: { ...WRITTEN, pub: '## PRs\n\n## Janela\n' } }, TEMPLATES))
      .rejects.toThrow('Nothing was created. pub: The description is empty or still the untouched "Publication" template');
    expect(creates).toEqual([]);
  });

  it('shows in the dry run which template each card follows and whether its description is there', async () => {
    const { svc, creates } = makeService();
    const result = await svc.applyFlow(FLOWS, { parentId: 100, dryRun: true, descriptions: { tests: WRITTEN.tests } }, TEMPLATES);
    expect((result.cards as any[]).map(c => [c.key, c.action, c.template, c.description, c.assignedTo])).toEqual([
      ['tests', 'would-create', 'technical tests', 'provided', 'me@acme.dev'],
      ['pub', 'would-create', 'Publication', 'missing', 'me@acme.dev'],
    ]);
    expect(creates).toEqual([]);
  });

  it('rejects descriptions for keys the flow does not have', async () => {
    const { svc } = makeService();
    await expect(svc.applyFlow(FLOWS, { parentId: 100, descriptions: { ...WRITTEN, revew: 'x' } }, TEMPLATES))
      .rejects.toThrow('Descriptions for unknown card key(s): revew');
  });

  it('creates without descriptions when asked with noTemplate', async () => {
    const { svc, creates } = makeService();
    await svc.applyFlow(FLOWS, { parentId: 100, noTemplate: true }, TEMPLATES);
    expect(creates.map(c => c.ops.some(o => o.path === '/fields/System.Description'))).toEqual([false, false]);
  });
});
