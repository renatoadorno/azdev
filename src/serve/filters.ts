import { CARD_FIELDS, FACETS, type Card, type CardField, type Facet, type ItemFilter, type Meta } from '../interfaces/Serve';
import { CURRENT_SPRINT_ALIASES, matchIteration, suggestIterations } from '../services/iterations';
import { parseSince } from '../services/queryBuilder';
import { currentSprint, previousSprint } from './meta';
import { ProtocolError } from './protocol';

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

const LIST_KEYS = ['assignee', 'sprint', 'state', 'category', 'type', 'tag', 'area'] as const;
const FILTER_KEYS: readonly string[] = [...LIST_KEYS, 'parent', 'open', 'q', 'changedSince'];
const CLOSED_CATEGORIES = ['completed', 'removed'];

export interface SortKey {
  field: CardField;
  descending: boolean;
}

export interface ParsedQuery {
  filter: ItemFilter;
  sort: SortKey[];
  fields?: CardField[];
  limit: number;
  offset: number;
  facets: Facet[];
}

function invalid(message: string, hint?: string): ProtocolError {
  return new ProtocolError('invalid_request', message, null, hint);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One value or a list of them; values of one key are OR'ed. */
function stringList(value: unknown, key: string): string[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0 || !list.every(v => typeof v === 'string' && v.trim())) {
    throw invalid(`filter.${key} must be a non-empty string or list of strings`);
  }
  return list.map(v => (v as string).trim());
}

function numberList(value: unknown, key: string): number[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0 || !list.every(v => Number.isSafeInteger(v) && (v as number) > 0)) {
    throw invalid(`filter.${key} must be a work item id or a list of them`);
  }
  return list as number[];
}

/** An ISO instant, or what `--changedSince` takes: 7d, 2w, today, YYYY-MM-DD. */
export function parseChangedSince(value: string, now = new Date()): Date {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const instant = new Date(value);
    if (!Number.isNaN(instant.getTime())) return instant;
  }
  try {
    return parseSince(value, now);
  } catch (err) {
    throw invalid(`filter.changedSince: ${(err as Error).message}`);
  }
}

function parseFilter(value: unknown): ItemFilter {
  if (value === undefined) return {};
  if (!isRecord(value)) throw invalid('"filter" must be an object');
  const unknown = Object.keys(value).find(key => !FILTER_KEYS.includes(key));
  if (unknown) throw invalid(`Unknown filter key "${unknown}"`, `Filter keys: ${FILTER_KEYS.join(', ')}`);

  const lists = Object.fromEntries(
    LIST_KEYS.map(key => [key, stringList(value[key], key)]).filter(([, list]) => list !== undefined),
  ) as Pick<ItemFilter, (typeof LIST_KEYS)[number]>;
  if (value.open !== undefined && typeof value.open !== 'boolean') throw invalid('filter.open must be true or false');
  if (value.q !== undefined && (typeof value.q !== 'string' || !value.q.trim())) throw invalid('filter.q must be a non-empty string');
  if (value.changedSince !== undefined) {
    if (typeof value.changedSince !== 'string') throw invalid('filter.changedSince must be a string');
    parseChangedSince(value.changedSince);
  }
  const parent = numberList(value.parent, 'parent');
  return {
    ...lists,
    ...(parent ? { parent } : {}),
    ...(value.open !== undefined ? { open: value.open as boolean } : {}),
    ...(value.q !== undefined ? { q: (value.q as string).trim() } : {}),
    ...(value.changedSince !== undefined ? { changedSince: value.changedSince as string } : {}),
  };
}

function isCardField(value: unknown): value is CardField {
  return typeof value === 'string' && (CARD_FIELDS as readonly string[]).includes(value);
}

function parseSort(value: unknown): SortKey[] {
  if (value === undefined) return [{ field: 'changedAt', descending: true }];
  const list = Array.isArray(value) ? value : [value];
  return list.map(entry => {
    const text = typeof entry === 'string' ? entry.trim() : '';
    const descending = text.startsWith('-');
    const field = descending ? text.slice(1) : text;
    if (!isCardField(field)) throw invalid(`Cannot sort by "${String(entry)}"`, `Card fields: ${CARD_FIELDS.join(', ')}`);
    return { field, descending };
  });
}

function parseFields(value: unknown): CardField[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isCardField)) {
    throw invalid('"fields" must be a list of card fields', `Card fields: ${CARD_FIELDS.join(', ')}`);
  }
  return [...new Set<CardField>(['id', ...value])];
}

function parseFacets(value: unknown): Facet[] {
  if (value === undefined) return [];
  const known = FACETS as readonly unknown[];
  if (!Array.isArray(value) || !value.every(f => known.includes(f))) {
    throw invalid('"facets" must be a list of facets', `Facets: ${FACETS.join(', ')}`);
  }
  return [...new Set(value as Facet[])];
}

function integer(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw invalid(`"${name}" must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

/** Untrusted params of items.list / items.watch → a query, or invalid_request naming what is wrong. */
export function parseItemsQuery(params: Record<string, unknown>): ParsedQuery {
  const fields = parseFields(params.fields);
  return {
    filter: parseFilter(params.filter),
    sort: parseSort(params.sort),
    ...(fields ? { fields } : {}),
    limit: integer(params.limit, 'limit', 1, MAX_LIMIT, DEFAULT_LIMIT),
    offset: integer(params.offset, 'offset', 0, Number.MAX_SAFE_INTEGER, 0),
    facets: parseFacets(params.facets),
  };
}

/** Sprint values → paths: current, previous, a number, a name or a full path. */
export function resolveSprintPaths(values: string[], meta: Meta, now = new Date()): string[] {
  const iterations = meta.sprints.map(s => ({ id: s.id, name: s.name, path: s.path }));
  return values.map(value => {
    const wanted = value.trim().toLowerCase();
    if (CURRENT_SPRINT_ALIASES.includes(wanted)) {
      const sprint = currentSprint(meta, now);
      if (!sprint) throw invalid('The team has no current sprint');
      return sprint.path;
    }
    if (wanted === 'previous') {
      const sprint = previousSprint(meta, now);
      if (!sprint) throw invalid('The team has no previous sprint');
      return sprint.path;
    }
    let match;
    try {
      match = matchIteration(value, iterations);
    } catch (err) {
      throw invalid((err as Error).message);
    }
    if (match?.path) return match.path;
    const suggestions = suggestIterations(value, iterations);
    throw invalid(`Sprint "${value}" not found`, suggestions.length ? `Did you mean: ${suggestions.join(', ')}?` : undefined);
  });
}

export interface MatchContext {
  meEmail: string;
  sprintPaths: Set<string> | null;
  since: Date | null;
}

export function matchContext(filter: ItemFilter, meta: Meta, now = new Date()): MatchContext {
  return {
    meEmail: meta.me.email.toLowerCase(),
    sprintPaths: filter.sprint ? new Set(resolveSprintPaths(filter.sprint, meta, now).map(p => p.toLowerCase())) : null,
    since: filter.changedSince ? parseChangedSince(filter.changedSince, now) : null,
  };
}

/** Case- and accent-insensitive: "acao" finds "Ação". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const same = (a: string | undefined, b: string) => (a ?? '').toLowerCase() === b.toLowerCase();
const anyOf = <T>(list: T[] | undefined, test: (value: T) => boolean) => !list || list.some(test);

function matchesAssignee(card: Card, wanted: string, meEmail: string): boolean {
  const value = wanted.toLowerCase();
  if (value === 'any') return true;
  if (value === 'none') return card.assignedTo === null;
  if (value === '@me') return card.assignedTo?.email?.toLowerCase() === meEmail;
  return same(card.assignedTo?.email, wanted) || same(card.assignedTo?.name, wanted);
}

function matchesText(card: Card, q: string): boolean {
  const id = q.match(/^#?(\d+)$/)?.[1];
  if (id && card.id === Number(id)) return true;
  if (q.startsWith('#')) return false;
  return fold(card.title).includes(fold(q));
}

export function isOpenCard(card: Card): boolean {
  return !CLOSED_CATEGORIES.includes(card.stateCategory.toLowerCase());
}

export function matchesFilter(card: Card, filter: ItemFilter, context: MatchContext): boolean {
  return (
    anyOf(filter.assignee, a => matchesAssignee(card, a, context.meEmail)) &&
    (!context.sprintPaths || (card.sprint !== null && context.sprintPaths.has(card.sprint.path.toLowerCase()))) &&
    anyOf(filter.state, s => same(card.state, s)) &&
    anyOf(filter.category, c => same(card.stateCategory, c)) &&
    (filter.open === undefined || isOpenCard(card) === filter.open) &&
    anyOf(filter.type, t => same(card.type, t)) &&
    anyOf(filter.tag, t => card.tags.some(tag => same(tag, t))) &&
    anyOf(filter.area, a => same(card.area, a) || card.area.toLowerCase().startsWith(`${a.toLowerCase()}\\`)) &&
    anyOf(filter.parent, id => card.parent?.id === id) &&
    (!filter.q || matchesText(card, filter.q)) &&
    (!context.since || Date.parse(card.changedAt) >= context.since.getTime())
  );
}

function sortValue(card: Card, field: CardField): string | number | undefined {
  switch (field) {
    case 'assignedTo':
      return card.assignedTo?.name;
    case 'changedBy':
      return card.changedBy?.name;
    case 'sprint':
      return card.sprint ? (card.sprint.start ?? card.sprint.path) : undefined;
    case 'parent':
      return card.parent?.id;
    case 'children':
      return card.children.total;
    case 'tags':
      return card.tags.join(', ') || undefined;
    default:
      return card[field] as string | number | undefined;
  }
}

/** Missing values go last in either direction; ties fall back to the newest id. */
function compareCards(a: Card, b: Card, keys: SortKey[]): number {
  for (const { field, descending } of keys) {
    const x = sortValue(a, field);
    const y = sortValue(b, field);
    if (x === y) continue;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    if (order !== 0) return descending ? -order : order;
  }
  return b.id - a.id;
}

function facetValues(card: Card, facet: Facet): string[] {
  switch (facet) {
    case 'state':
      return [card.state];
    case 'category':
      return [card.stateCategory];
    case 'type':
      return [card.type];
    case 'assignee':
      return [card.assignedTo?.name ?? '(unassigned)'];
    case 'sprint':
      return [card.sprint?.name ?? '(none)'];
    case 'tag':
      return card.tags;
  }
}

function project(card: Card, fields?: CardField[]): Partial<Card> {
  if (!fields) return card;
  return Object.fromEntries(fields.filter(f => card[f] !== undefined).map(f => [f, card[f]])) as Partial<Card>;
}

/** Filter, count facets over the whole match, sort, page, then pick the fields. */
export function queryCards(cards: Card[], query: ParsedQuery, context: MatchContext) {
  const matched = cards.filter(card => matchesFilter(card, query.filter, context));
  const facets = query.facets.length
    ? Object.fromEntries(
        query.facets.map(facet => {
          const counts: Record<string, number> = {};
          for (const card of matched) for (const value of facetValues(card, facet)) counts[value] = (counts[value] ?? 0) + 1;
          return [facet, counts];
        }),
      )
    : undefined;
  const page = [...matched].sort((a, b) => compareCards(a, b, query.sort)).slice(query.offset, query.offset + query.limit);
  return {
    items: page.map(card => project(card, query.fields)),
    total: matched.length,
    ...(facets ? { facets } : {}),
  };
}
