/**
 * Description templates: one Markdown file per work item type (or any other
 * name a flow card points at), kept in the user's config directory. A template
 * is a model to write from — never the description itself: a card created
 * from one must carry the task's own content in the template's structure.
 */

import type { DescriptionTemplate } from '../interfaces/WorkItems';
import { decodeEntities } from './richText';

export type { DescriptionTemplate };

export interface TemplateFill {
  /** Title of the card being created. */
  title: string;
  parentId?: number;
  parentTitle?: string;
}

export function findTemplate(templates: DescriptionTemplate[], name: string): DescriptionTemplate | undefined {
  const wanted = name.trim().toLowerCase();
  return templates.find(t => t.name.toLowerCase() === wanted);
}

/**
 * Fills `{title}`, `{parentId}` and `{parentTitle}`. A value left out becomes
 * empty — or stays as its placeholder with `keepMissing`, to show the model.
 */
export function fillTemplate(content: string, fill: Partial<TemplateFill>, keepMissing = false): string {
  const value = (key: keyof TemplateFill) => {
    const v = fill[key];
    if (v !== undefined) return String(v);
    return keepMissing ? `{${key}}` : '';
  };
  return content
    .replace(/\{title\}/g, () => value('title'))
    .replace(/\{parentId\}/g, () => value('parentId'))
    .replace(/\{parentTitle\}/g, () => value('parentTitle'));
}

/** Whether filling needs the parent's title — the only placeholder that costs an API call. */
export function needsParentTitle(content: string): boolean {
  return content.includes('{parentTitle}');
}

// Decode before stripping tags: storage encodes a template's literal `<descreva>` as
// `&lt;descreva&gt;`, and both sides must normalize the same way.
function normalized(text: string): string {
  return decodeEntities(text).replace(/<[^>]*>/g, '').replace(/\s+/g, '');
}

/** Empty, or still the untouched model it started from. */
export function isUnfilled(description: unknown, model?: string): boolean {
  if (typeof description !== 'string') return true;
  const text = normalized(description);
  return text === '' || (model !== undefined && text === normalized(model));
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;

export function headings(markdown: string): string[] {
  return [...markdown.matchAll(HEADING)].map(m => m[1]!.trim());
}

/** Headings of the model the description does not have — sections left out. */
export function missingSections(description: string, model: string): string[] {
  const present = new Set(headings(description).map(h => h.toLowerCase()));
  return headings(model).filter(h => !present.has(h.toLowerCase()));
}

export interface DescriptionCheck {
  /** Why the description cannot be used, when it cannot. */
  error?: string;
  /** Sections of the model missing from the description. */
  missing: string[];
}

/** The `<…>` prompts of a model — what the writer replaces with the task's content. */
export function templatePrompts(model: string): string[] {
  return [...new Set(model.match(/<[^<>\n]+>/g) ?? [])];
}

/** Checks a description written from `model` (already filled for the card). */
export function checkDescription(description: string | undefined, model: string, templateName: string): DescriptionCheck {
  if (description === undefined) {
    return {
      error: `This card follows the "${templateName}" template: write its description with the task's own content and pass it (--descriptionFile).`,
      missing: [],
    };
  }
  if (isUnfilled(description, model)) {
    return { error: `The description is empty or still the untouched "${templateName}" template — fill it with the task's own content.`, missing: [] };
  }
  // A prompt left in place is a section half-written: the card would carry the model's words, not the task's.
  const leftover = templatePrompts(model).filter(prompt => description.includes(prompt));
  if (leftover.length) {
    return {
      error: `The description still has prompts of the "${templateName}" template: ${leftover.join(', ')} — replace them with the task's content, or drop what does not apply.`,
      missing: [],
    };
  }
  return { missing: missingSections(description, model) };
}
