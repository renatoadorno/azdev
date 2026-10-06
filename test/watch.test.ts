import { describe, expect, it } from 'bun:test';
import { addWatch, archiveWatch, EMPTY_WATCH, parseWatchFile, removeWatch, watchedIds } from '../src/services/watch';

const MONDAY = new Date('2026-10-05T09:00:00.000Z');
const TUESDAY = new Date('2026-10-06T09:00:00.000Z');

const watching = (...ids: number[]) => ids.map(id => ({ id, since: MONDAY.toISOString() }));

describe('addWatch', () => {
  it('adds a card with the time it started being watched', () => {
    expect(addWatch(EMPTY_WATCH, 14547, MONDAY)).toEqual({ watching: watching(14547), archived: [] });
  });

  it('keeps the date of a card already watched', () => {
    const list = { watching: watching(14547), archived: [] };
    expect(addWatch(list, 14547, TUESDAY)).toBe(list);
  });

  it('brings a card back from the archive', () => {
    const list = { watching: [], archived: [{ id: 14547, since: MONDAY.toISOString(), archivedAt: MONDAY.toISOString() }] };
    expect(addWatch(list, 14547, TUESDAY)).toEqual({ watching: [{ id: 14547, since: TUESDAY.toISOString() }], archived: [] });
  });
});

describe('removeWatch', () => {
  it('drops the card from the list and from the archive', () => {
    const list = { watching: watching(1, 2), archived: [{ id: 2, since: MONDAY.toISOString(), archivedAt: MONDAY.toISOString() }] };
    expect(removeWatch(list, 2)).toEqual({ watching: watching(1), archived: [] });
  });
});

describe('archiveWatch', () => {
  it('moves closed cards to the archive with the time they left', () => {
    const list = { watching: watching(1, 2, 3), archived: [] };
    const archived = archiveWatch(list, [3, 1], TUESDAY);
    expect(archived).toEqual({
      watching: watching(2),
      archived: [
        { id: 1, since: MONDAY.toISOString(), archivedAt: TUESDAY.toISOString() },
        { id: 3, since: MONDAY.toISOString(), archivedAt: TUESDAY.toISOString() },
      ],
    });
    expect(watchedIds(archived)).toEqual([2]);
  });

  it('leaves the list as it is when none of the ids is watched', () => {
    const list = { watching: watching(1), archived: [] };
    expect(archiveWatch(list, [9], TUESDAY)).toBe(list);
  });

  it('replaces an older archive entry of a card watched again', () => {
    const list = { watching: watching(1), archived: [{ id: 1, since: '2026-09-01T00:00:00.000Z', archivedAt: '2026-09-10T00:00:00.000Z' }] };
    expect(archiveWatch(list, [1], TUESDAY).archived).toEqual([{ id: 1, since: MONDAY.toISOString(), archivedAt: TUESDAY.toISOString() }]);
  });
});

describe('parseWatchFile', () => {
  const FILE = '/home/me/.config/azdev/watch.json';

  it('reads the lists of each project', () => {
    const archived = [{ id: 14000, since: MONDAY.toISOString(), archivedAt: TUESDAY.toISOString() }];
    const content = JSON.stringify({ projects: { Demo: { watching: watching(14547), archived }, Other: { watching: [] } } });
    expect(parseWatchFile(content, FILE)).toEqual({
      Demo: { watching: watching(14547), archived },
      Other: { watching: [], archived: [] },
    });
  });

  it('reads a file without projects as watching nothing', () => {
    expect(parseWatchFile('{}', FILE)).toEqual({});
  });

  it('refuses a file it cannot read, rather than letting the next save overwrite it', () => {
    expect(() => parseWatchFile('{ broken', FILE)).toThrow(`${FILE} is not valid JSON`);
    expect(() => parseWatchFile('[]', FILE)).toThrow('must be a JSON object');
    expect(() => parseWatchFile('{"projects": []}', FILE)).toThrow('"projects" must be an object');
    expect(() => parseWatchFile('{"projects": {"Demo": {"watching": {}}}}', FILE)).toThrow('projects["Demo"].watching must be a list');
  });

  it('names the entry that is not a card id with a date', () => {
    const bad = (entry: unknown, list = 'watching') => JSON.stringify({ projects: { Demo: { [list]: [...(list === 'watching' ? watching(1) : []), entry] } } });
    expect(() => parseWatchFile(bad({ id: '2', since: MONDAY.toISOString() }), FILE)).toThrow('projects["Demo"].watching[1] must be { id, since }');
    expect(() => parseWatchFile(bad({ id: 2, since: 'yesterday' }), FILE)).toThrow('watching[1]');
    expect(() => parseWatchFile(bad({ id: 0, since: MONDAY.toISOString() }), FILE)).toThrow('watching[1]');
    expect(() => parseWatchFile(bad({ id: 2, since: MONDAY.toISOString() }, 'archived'), FILE)).toThrow('archived[0] must be { id, since, archivedAt }');
  });
});
