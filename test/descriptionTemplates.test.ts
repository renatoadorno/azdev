import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkDescription,
  fillTemplate,
  findTemplate,
  headings,
  isUnfilled,
  missingSections,
  needsParentTitle,
} from '../src/services/descriptionTemplates';
import { chooseTemplate, loadTemplates, readCardDescriptions, templatesDir } from '../src/cli/templates';
import { ExitError, captureExit, captureStderr, cleanupTempConfigs, createEnvGuard, makeTempConfig } from './helpers';

const PUBLICATION = '## PRs\n\n- <repo>: <URL>\n\n## Janela\n\n## Critérios de aceite\n';

describe('fillTemplate', () => {
  it('fills title, parent id and parent title', () => {
    expect(fillTemplate('{title} de #{parentId} ({parentTitle})', { title: 'Publicar', parentId: 12, parentTitle: 'Carrinho' }))
      .toBe('Publicar de #12 (Carrinho)');
  });

  it('empties what is not known, or keeps the placeholder to show the model', () => {
    expect(fillTemplate('#{parentId} {parentTitle}', { title: 'x' })).toBe('# ');
    expect(fillTemplate('{title} #{parentId}', {}, true)).toBe('{title} #{parentId}');
  });

  it('tells when the parent title must be fetched', () => {
    expect(needsParentTitle('história: {parentTitle}')).toBe(true);
    expect(needsParentTitle('história: #{parentId}')).toBe(false);
  });
});

describe('templates as models', () => {
  it('finds a template by name, case-insensitive', () => {
    expect(findTemplate([{ name: 'Publication [PROD]', content: '' }], 'publication [prod]')?.name).toBe('Publication [PROD]');
  });

  it('lists the headings of a model', () => {
    expect(headings(PUBLICATION)).toEqual(['PRs', 'Janela', 'Critérios de aceite']);
  });

  it('treats an untouched or empty description as unfilled, entities and whitespace aside', () => {
    expect(isUnfilled('## PRs\n- &lt;repo&gt;: &lt;URL&gt;\n## Janela\n## Critérios de aceite', PUBLICATION)).toBe(true);
    expect(isUnfilled('  ', PUBLICATION)).toBe(true);
    expect(isUnfilled('## PRs\n- api: https://x/pr/1', PUBLICATION)).toBe(false);
  });

  it('lists the model sections a description leaves out', () => {
    expect(missingSections('## PRs\nx\n## critérios de aceite\ny', PUBLICATION)).toEqual(['Janela']);
  });

  it('refuses a description that keeps prompts of the model', () => {
    const half = '## PRs\n- <repo>: <URL>\n## Janela\n1. deploy\n## Critérios de aceite\n- no ar';
    expect(checkDescription(half, PUBLICATION, 'Publication').error).toBe(
      'The description still has prompts of the "Publication" template: <repo>, <URL> — replace them with the task\'s content, or drop what does not apply.',
    );
  });

  it('refuses a missing description and the untouched model, and passes written content', () => {
    expect(checkDescription(undefined, PUBLICATION, 'Publication').error).toContain('write its description');
    expect(checkDescription(PUBLICATION, PUBLICATION, 'Publication').error).toContain('untouched');
    expect(checkDescription('## PRs\n- api: https://x/pr/1\n## Janela\n1. deploy\n## Critérios de aceite\n- no ar', PUBLICATION, 'Publication'))
      .toEqual({ missing: [] });
  });
});

describe('templates directory', () => {
  let env = createEnvGuard();
  let exit = captureExit();
  let stderr = captureStderr();

  beforeEach(() => {
    env = createEnvGuard();
    env.set('AZDEV_CONFIG_PATH', makeTempConfig({ orgUrl: 'https://dev.azure.com/acme', project: 'Demo' }));
    exit = captureExit();
    stderr = captureStderr();
  });

  afterEach(() => {
    env.restore();
    exit.mockRestore();
    stderr.spy.mockRestore();
    cleanupTempConfigs();
  });

  function writeTemplates(files: Record<string, string>) {
    fs.mkdirSync(templatesDir(), { recursive: true });
    for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(templatesDir(), file), content);
  }

  it('loads every .md as a template named after the file, and nothing when the directory is missing', () => {
    expect(loadTemplates()).toEqual([]);
    writeTemplates({ 'Publication.md': PUBLICATION, 'technical tests.md': '## Resultado', 'notes.txt': 'x' });
    expect(loadTemplates().map(t => t.name)).toEqual(['Publication', 'technical tests']);
  });

  it("picks the type's template by default, the named one on request, and none with noTemplate", () => {
    writeTemplates({ 'Publication.md': PUBLICATION, 'Publication [PROD].md': '## Janela' });
    const templates = loadTemplates();
    expect(chooseTemplate(templates, 'publication', {})?.name).toBe('Publication');
    expect(chooseTemplate(templates, 'Publication', { template: 'Publication [PROD]' })?.name).toBe('Publication [PROD]');
    expect(chooseTemplate(templates, 'Publication', { noTemplate: true })).toBeUndefined();
    expect(chooseTemplate(templates, 'Bug', {})).toBeUndefined();
  });

  it('exits 1 listing the templates when a named one does not exist', () => {
    writeTemplates({ 'Publication.md': PUBLICATION });
    expect(() => chooseTemplate(loadTemplates(), 'Task', { template: 'Reviw' })).toThrow(ExitError);
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr.text()).toContain('Template "Reviw" not found. Available: Publication');
  });

  it('reads one description per card key from a directory', () => {
    const dir = path.join(path.dirname(templatesDir()), 'descs');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'review.md'), '## PRs\n- api');
    fs.writeFileSync(path.join(dir, 'README'), 'ignored');
    expect(readCardDescriptions(dir)).toEqual({ review: '## PRs\n- api' });
  });
});
