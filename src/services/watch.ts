/**
 * Pure rules of `workitem watch`: the cards the user follows besides their own (a story
 * whose cycle cards belong to other people), kept per project, and the archive of the
 * ones that closed.
 */

export interface WatchEntry {
  id: number;
  /** When the user started watching it. */
  since: string;
}

export interface ArchivedWatch extends WatchEntry {
  archivedAt: string;
}

export interface ProjectWatch {
  watching: WatchEntry[];
  archived: ArchivedWatch[];
}

export const EMPTY_WATCH: ProjectWatch = { watching: [], archived: [] };

export const watchedIds = (list: ProjectWatch): number[] => list.watching.map(entry => entry.id);

/** A card already watched keeps its date; one in the archive comes back to the list. */
export function addWatch(list: ProjectWatch, id: number, at: Date): ProjectWatch {
  if (list.watching.some(entry => entry.id === id)) return list;
  return {
    watching: [...list.watching, { id, since: at.toISOString() }],
    archived: list.archived.filter(entry => entry.id !== id),
  };
}

/** Stops watching a card and drops it from the archive too. */
export function removeWatch(list: ProjectWatch, id: number): ProjectWatch {
  return {
    watching: list.watching.filter(entry => entry.id !== id),
    archived: list.archived.filter(entry => entry.id !== id),
  };
}

/** Closed cards leave the list for the archive, which stays queryable. */
export function archiveWatch(list: ProjectWatch, ids: number[], at: Date): ProjectWatch {
  const closing = list.watching.filter(entry => ids.includes(entry.id));
  if (closing.length === 0) return list;
  return {
    watching: list.watching.filter(entry => !ids.includes(entry.id)),
    archived: [
      ...list.archived.filter(entry => !ids.includes(entry.id)),
      ...closing.map(entry => ({ ...entry, archivedAt: at.toISOString() })),
    ],
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isInstant = (value: unknown) => typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

function entries<T extends WatchEntry>(value: unknown, where: string, extra: (keyof T)[] = []): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${where} must be a list`);
  return value.map((entry, i) => {
    const ok = isRecord(entry)
      && Number.isInteger(entry.id) && (entry.id as number) > 0
      && isInstant(entry.since)
      && extra.every(key => isInstant(entry[key as string]));
    if (!ok) throw new Error(`${where}[${i}] must be { id, since${extra.map(k => `, ${String(k)}`).join('')} }: ${JSON.stringify(entry)}`);
    return entry as T;
  });
}

/**
 * watch.json content → watch lists per project. A malformed file throws instead of
 * reading as empty: the next save would overwrite the cards the user watches.
 */
export function parseWatchFile(content: string, file: string): Record<string, ProjectWatch> {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${(err as Error).message}). Fix or remove it — it holds the cards you watch.`);
  }
  if (!isRecord(data)) throw new Error(`${file} must be a JSON object`);
  const { projects } = data;
  if (projects === undefined) return {};
  if (!isRecord(projects)) throw new Error(`${file}: "projects" must be an object`);
  return Object.fromEntries(Object.entries(projects).map(([project, value]) => {
    const where = `${file}: projects["${project}"]`;
    if (!isRecord(value)) throw new Error(`${where} must be an object`);
    return [project, {
      watching: entries<WatchEntry>(value.watching, `${where}.watching`),
      archived: entries<ArchivedWatch>(value.archived, `${where}.archived`, ['archivedAt']),
    }];
  }));
}
