/**
 * Pure rules behind `azdev flow`: validate a flows file, match a story's
 * children to the cards of its flow, audit the cycle and plan what to create.
 */

import type { FlowCard, FlowDefinition, FlowsFile } from '../interfaces/Flows';
import { fillTemplate, findTemplate, isUnfilled, type DescriptionTemplate } from './descriptionTemplates';
import { REMOVED_STATE, isClosedState, type WorkItemRow as Row } from './workItemUtils';

export interface TemplateContext {
  title: string;
  id: number;
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(/\{(title|id)\}/g, (_m, key: 'title' | 'id') => String(ctx[key]));
}

function sameType(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

function cardFits(card: FlowCard, type: unknown, title: unknown): boolean {
  if (!sameType(type, card.type)) return false;
  return !card.match || new RegExp(card.match, 'i').test(String(title ?? ''));
}

/** The first card of the flow a child counts as — order in the file decides ties. */
export function cardFor(cards: FlowCard[], row: Row): FlowCard | undefined {
  return cards.find(card => cardFits(card, row.WorkItemType, row.Title));
}

const SAMPLE_CONTEXT: TemplateContext = { title: 'Sample story', id: 1 };

function cardLabel(card: FlowCard, index: number, flowName: string): string {
  return `flow "${flowName}", card ${card?.key ? `"${card.key}"` : `#${index + 1}`}`;
}

function validateCardShape(card: FlowCard, index: number, flowName: string): string[] {
  const where = cardLabel(card, index, flowName);
  if (!card || typeof card !== 'object') return [`${where}: must be an object`];
  const problems: string[] = [];
  for (const field of ['key', 'type', 'title'] as const) {
    if (typeof card[field] !== 'string' || !card[field].trim()) problems.push(`${where}: "${field}" is required`);
  }
  if (card.match !== undefined) {
    try {
      new RegExp(card.match, 'i');
    } catch (err) {
      problems.push(`${where}: "match" is not a valid regex (${(err as Error).message})`);
    }
  }
  if (card.retestAfter !== undefined && !Array.isArray(card.retestAfter)) {
    problems.push(`${where}: "retestAfter" must be a list of work item types`);
  }
  if (card.template !== undefined && (typeof card.template !== 'string' || !card.template.trim())) {
    problems.push(`${where}: "template" must be the name of a file in templates/`);
  }
  if (card.expectedCarryover !== undefined && typeof card.expectedCarryover !== 'boolean') {
    problems.push(`${where}: "expectedCarryover" must be true or false`);
  }
  return problems;
}

/** Cards of every flow whose sprint moves are part of the process (`expectedCarryover`). */
export function expectedCarryoverCards(file: FlowsFile | null): FlowCard[] {
  return file ? Object.values(file.flows).flatMap(flow => flow.cards.filter(card => card.expectedCarryover)) : [];
}

/** Whether an item counts as one of these cards (same type, title matching the card's `match`). */
export function fitsAnyCard(cards: FlowCard[], row: Row): boolean {
  return cards.some(card => cardFits(card, row.WorkItemType, row.Title));
}

/** Card that a child of `card`'s type titled `title` would count as, when it is not `card` itself. */
export function stolenBy(cards: FlowCard[], card: FlowCard, title: string): FlowCard | null | undefined {
  const owner = cardFor(cards, { WorkItemType: card.type, Title: title });
  if (owner === card) return undefined;
  return owner ?? null;
}

// A created card must count as itself on the next run, or `apply` would never stop creating it.
// Only meaningful once every card of the flow has a valid shape — matching runs every card's regex.
function validateSelfMatch(card: FlowCard, index: number, cards: FlowCard[], flowName: string): string[] {
  const title = renderTemplate(card.title, SAMPLE_CONTEXT);
  const owner = stolenBy(cards, card, title);
  if (owner === undefined) return [];
  const where = cardLabel(card, index, flowName);
  return [
    owner
      ? `${where}: a card titled "${title}" would count as card "${owner.key}" — give both a distinct "match"`
      : `${where}: its title does not match its own "match", so apply would create it again on every run`,
  ];
}

/** Checks a parsed flows file; throws one error listing every problem. */
export function validateFlows(raw: unknown): FlowsFile {
  const problems: string[] = [];
  const file = raw as FlowsFile;
  if (!file || typeof file !== 'object' || !file.flows || typeof file.flows !== 'object') {
    throw new Error('flows file must be an object with a "flows" map');
  }
  if (file.operationalTypes !== undefined && !Array.isArray(file.operationalTypes)) {
    problems.push('"operationalTypes" must be a list of work item types');
  }
  if (file.backlogSprints !== undefined && (!Array.isArray(file.backlogSprints) || file.backlogSprints.some(s => typeof s !== 'string' || !s.trim()))) {
    problems.push('"backlogSprints" must be a list of sprint names or paths');
  }

  for (const [name, flow] of Object.entries(file.flows)) {
    if (!flow || !Array.isArray(flow.cards) || flow.cards.length === 0) {
      problems.push(`flow "${name}": "cards" must be a non-empty list`);
      continue;
    }
    const keys = new Set<string>();
    const shapeProblems: string[] = [];
    flow.cards.forEach((card, index) => {
      if (card?.key && keys.has(card.key)) shapeProblems.push(`flow "${name}": duplicate card key "${card.key}"`);
      if (card?.key) keys.add(card.key);
      shapeProblems.push(...validateCardShape(card, index, name));
    });
    problems.push(...shapeProblems);
    if (shapeProblems.length === 0) {
      flow.cards.forEach((card, index) => problems.push(...validateSelfMatch(card, index, flow.cards, name)));
    }
  }

  if (problems.length) throw new Error(`Invalid flows file:\n- ${problems.join('\n- ')}`);
  return file;
}

/** Names of the flows whose `parentTypes` include the parent's type. */
export function applicableFlows(file: FlowsFile, parentType: string): string[] {
  return Object.keys(file.flows).filter(n => (file.flows[n]!.parentTypes ?? []).some(t => sameType(parentType, t)));
}

/** The named flow, or the only one whose `parentTypes` include the parent's type. */
export function pickFlow(file: FlowsFile, parentType: string, name?: string): [string, FlowDefinition] {
  const names = Object.keys(file.flows);
  if (name) {
    const flow = file.flows[name];
    if (!flow) throw new Error(`Flow "${name}" not found. Defined: ${names.join(', ') || 'none'}`);
    return [name, flow];
  }

  const candidates = applicableFlows(file, parentType);
  if (candidates.length === 1) return [candidates[0]!, file.flows[candidates[0]!]!];
  if (candidates.length === 0) {
    throw new Error(`No flow applies to "${parentType}". Pass one by name: ${names.join(', ') || 'none defined'}`);
  }
  throw new Error(`Several flows apply to "${parentType}" (${candidates.join(', ')}). Pass one by name.`);
}

export interface CardMatch {
  card: FlowCard;
  items: Row[];
}

/** Assigns each active child to the first card it fits; Removed children count as absent. */
export function matchCards(cards: FlowCard[], children: Row[]): { matches: CardMatch[]; unmatched: Row[] } {
  const matches = cards.map(card => ({ card, items: [] as Row[] }));
  const unmatched: Row[] = [];
  for (const child of children) {
    if (child.State === REMOVED_STATE) continue;
    const card = cardFor(cards, child);
    if (card) matches.find(m => m.card === card)!.items.push(child);
    else unmatched.push(child);
  }
  return { matches, unmatched };
}

/** When a card was closed: ClosedDate when the type has it, else the last state change. */
export function closedAt(row: Row): string | undefined {
  if (!isClosedState(row.State)) return undefined;
  const value = row.ClosedDate ?? row.StateChangeDate;
  return value ? new Date(value as string).toISOString() : undefined;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

export type CardState = 'done' | 'open' | 'missing' | 'skipped';

/** Every key always present (empty when missing), so output stays one table. */
export interface CardStatus {
  key: string;
  type: string;
  status: CardState;
  ids: string;
  state: string;
  assignedTo: string;
}

export interface FlowEvaluation {
  cards: CardStatus[];
  findings: string[];
  others: Row[];
}

function joinUnique(rows: Row[], key: string): string {
  return [...new Set(rows.map(r => r[key]).filter(v => v !== undefined && v !== null).map(String))].join(', ');
}

function missingHint(card: FlowCard, unmatched: Row[]): string {
  const sameTypeRows = unmatched.filter(r => sameType(r.WorkItemType, card.type));
  if (sameTypeRows.length === 0 || !card.match) return '';
  const list = sameTypeRows.map(r => `#${r.id} "${r.Title}"`).join(', ');
  return ` — ${list} is a ${card.type} but its title does not match /${card.match}/i; rename it if it is this card`;
}

/** Latest close among the children that change code after a card (e.g. a fix after the tests). */
function latestChange(card: FlowCard, children: Row[]): { row: Row; at: string } | undefined {
  const types = card.retestAfter ?? [];
  let latest: { row: Row; at: string } | undefined;
  for (const row of children) {
    if (row.State === REMOVED_STATE || !types.some(t => sameType(row.WorkItemType, t))) continue;
    const at = closedAt(row);
    if (at && (!latest || at > latest.at)) latest = { row, at };
  }
  return latest;
}

/**
 * The description `apply` would have given `item` as `card`: the inline one rendered
 * for the story, else the template file for the card, filled for that item.
 */
export function startingDescription(
  card: FlowCard,
  item: Row,
  ctx?: TemplateContext,
  templates: DescriptionTemplate[] = [],
): string | undefined {
  if (card.description) return ctx ? renderTemplate(card.description, ctx) : card.description;
  const template = findTemplate(templates, card.template ?? card.type);
  if (!template) return undefined;
  return fillTemplate(template.content, { title: String(item.Title ?? ''), parentId: ctx?.id, parentTitle: ctx?.title });
}

/**
 * Audits a story against its flow. `lastCommentAt` maps a card id to its newest
 * comment date — a comment after the latest fix counts as the retest record.
 * `ctx` (the story) and `templates` rebuild the description each card started
 * with, so an untouched one counts as empty.
 */
export function evaluateFlow(
  flow: FlowDefinition,
  children: Row[],
  lastCommentAt: Map<number, string | undefined> = new Map(),
  ctx?: TemplateContext,
  templates: DescriptionTemplate[] = [],
): FlowEvaluation {
  const { matches, unmatched } = matchCards(flow.cards, children);
  const findings: string[] = [];

  const cards = matches.map(({ card, items }): CardStatus => {
    if (items.length === 0) {
      if (!card.optional) findings.push(`${card.key}: missing ${card.type} card${missingHint(card, unmatched)}`);
      return { key: card.key, type: card.type, status: card.optional ? 'skipped' : 'missing', ids: '', state: '', assignedTo: '' };
    }

    if (card.requireDescription) {
      for (const item of items.filter(i => isUnfilled(i.Description, startingDescription(card, i, ctx, templates)))) {
        findings.push(`${card.key}: #${item.id} has no description beyond the template — record what was done or tested, how, and the result`);
      }
    }

    const allClosed = items.every(i => isClosedState(i.State));
    if (allClosed && card.retestAfter?.length) {
      const change = latestChange(card, children);
      const evidence = items
        .flatMap(i => [closedAt(i), lastCommentAt.get(i.id!)])
        .filter((d): d is string => !!d)
        .sort()
        .pop();
      if (change && evidence && change.at > evidence) {
        const newest = items.map(i => ({ i, at: closedAt(i) ?? '' })).sort((a, b) => a.at.localeCompare(b.at)).pop()!;
        findings.push(
          `${card.key}: #${newest.i.id} closed ${day(newest.at)}, but #${change.row.id} (${change.row.WorkItemType}) closed ${day(change.at)} after it — record a retest (comment or new card)`,
        );
      }
    }

    return {
      key: card.key,
      type: card.type,
      status: allClosed ? 'done' : 'open',
      ids: items.map(i => i.id).join(','),
      state: joinUnique(items, 'State'),
      assignedTo: joinUnique(items, 'AssignedTo'),
    };
  });

  return { cards, findings, others: unmatched };
}

export interface PlannedCard {
  card: FlowCard;
  /** `conflict`: created with this title it would count as another card — never created. */
  action: 'create' | 'exists' | 'skipped' | 'conflict';
  /** Title to create with — or, for an existing card, the titles it already has. */
  title: string;
  ids?: string;
  reason?: string;
}

export interface PlanFilter {
  /** Only these card keys (optional ones included). */
  only?: string[];
  /** Every card except these keys. */
  skip?: string[];
  /** Optional cards to create too — they are left out by default. */
  with?: string[];
  /** Whole title of a card to create, by key, instead of its `title` (takes `{title}`/`{id}` too). */
  titles?: Record<string, string>;
}

/**
 * Which cards `apply` creates: every required card with no matching child,
 * plus optional ones asked for by `with`/`only`, minus `skip`.
 */
export function planFlow(flow: FlowDefinition, children: Row[], ctx: TemplateContext, filter: PlanFilter = {}): PlannedCard[] {
  const known = new Set(flow.cards.map(c => c.key));
  const titles = filter.titles ?? {};
  const unknown = [...(filter.only ?? []), ...(filter.skip ?? []), ...(filter.with ?? []), ...Object.keys(titles)].filter(k => !known.has(k));
  if (unknown.length) throw new Error(`Unknown card key(s): ${unknown.join(', ')}. Cards: ${[...known].join(', ')}`);
  const blank = Object.entries(titles).filter(([, title]) => typeof title !== 'string' || !title.trim()).map(([key]) => key);
  if (blank.length) throw new Error(`Empty title for card(s): ${blank.join(', ')}`);

  const { matches } = matchCards(flow.cards, children);
  return matches.map(({ card, items }) => {
    if (items.length) {
      return { card, action: 'exists', title: items.map(i => String(i.Title)).join(' | '), ids: items.map(i => i.id).join(',') };
    }
    const title = renderTemplate(titles[card.key] ?? card.title, ctx).trim();

    const wanted = filter.only
      ? filter.only.includes(card.key)
      : !card.optional || (filter.with ?? []).includes(card.key);
    if (!wanted || (filter.skip ?? []).includes(card.key)) return { card, action: 'skipped', title };

    // The file passed validation with a sample title; the story's real title can still
    // match another card's pattern (a story named "… [HOMOLOG]"), which would break idempotency.
    const owner = stolenBy(flow.cards, card, title);
    if (owner !== undefined) {
      const reason = owner
        ? `"${title}" would count as card "${owner.key}", so it would be created again on every run — tighten the "match" of "${owner.key}"`
        : `"${title}" does not match the card's own "match"`;
      return { card, action: 'conflict', title, reason };
    }
    return { card, action: 'create', title };
  });
}
