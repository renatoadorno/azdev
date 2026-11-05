import type { RawItem } from '../interfaces/Sync';

/** Identities come with avatars, links and descriptors; the cache keeps the name and account. */
export function slimIdentities(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([ref, value]) => {
      const identity = value as { displayName?: unknown; uniqueName?: unknown } | null;
      return typeof identity === 'object' && identity !== null && typeof identity.displayName === 'string'
        ? [ref, { displayName: identity.displayName, uniqueName: identity.uniqueName }]
        : [ref, value];
    }),
  );
}

interface ApiWorkItem {
  id?: number;
  rev?: number;
  fields?: Record<string, unknown>;
}

/**
 * A work item as the API returns it → what the cache keeps, or null when it lacks
 * an id or a revision. `only` limits the fields (an update answers with all of them).
 */
export function toRawItem(item: ApiWorkItem | null | undefined, only?: string[]): RawItem | null {
  if (item?.id === undefined || item.rev === undefined) return null;
  const wanted = only && new Set(only.map(ref => ref.toLowerCase()));
  const fields = Object.fromEntries(Object.entries(item.fields ?? {}).filter(([ref]) => !wanted || wanted.has(ref.toLowerCase())));
  return { id: item.id, rev: item.rev, fields: slimIdentities(fields) };
}
