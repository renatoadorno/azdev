import * as fs from 'fs';
import * as path from 'path';
import { findTemplate, type DescriptionTemplate } from '../services/descriptionTemplates';
import { siblingPath } from './config';
import { failUsage } from './parsers';

/** templates/ lives next to config.json, one `<name>.md` per work item type. */
export function templatesDir(): string {
  return siblingPath('templates');
}

/** Every `*.md` in the templates directory; none when it does not exist. */
export function loadTemplates(): DescriptionTemplate[] {
  const dir = templatesDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter(file => file.toLowerCase().endsWith('.md'))
    .sort()
    .map(file => ({ name: file.slice(0, -'.md'.length), content: fs.readFileSync(path.join(dir, file), 'utf-8') }));
}

/** The template a `--template` flag names; exits 1 listing the available ones when it does not exist. */
export function requireTemplate(templates: DescriptionTemplate[], name: string): DescriptionTemplate {
  const template = findTemplate(templates, name);
  if (template) return template;
  const available = templates.map(t => t.name).join(', ') || `none — add <name>.md files to ${templatesDir()}`;
  failUsage(`Template "${name}" not found. Available: ${available}`);
}

/** `<key>.md` files of a directory, by card key — the descriptions written for `flow apply`. */
export function readCardDescriptions(dir: string): Record<string, string> {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    failUsage(`Cannot read --descriptions '${dir}': ${(err as Error).message}`);
  }
  return Object.fromEntries(
    entries
      .filter(file => file.toLowerCase().endsWith('.md'))
      .map(file => [file.slice(0, -'.md'.length), fs.readFileSync(path.join(dir, file), 'utf-8')]),
  );
}

export interface TemplateChoice {
  template?: string;
  noTemplate?: boolean;
}

/**
 * The template a new card's description must be written from: the one named by
 * `template`, else the one named after its type; none with `noTemplate`.
 */
export function chooseTemplate(
  templates: DescriptionTemplate[],
  workItemType: string,
  choice: TemplateChoice,
): DescriptionTemplate | undefined {
  if (choice.noTemplate) return undefined;
  if (choice.template) return requireTemplate(templates, choice.template);
  return findTemplate(templates, workItemType);
}
