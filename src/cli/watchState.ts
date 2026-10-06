import * as fs from 'fs';
import * as path from 'path';
import { siblingPath } from './config';
import { EMPTY_WATCH, parseWatchFile, type ProjectWatch } from '../services/watch';

/** watch.json lives next to config.json, so AZDEV_CONFIG_PATH isolates it too. */
export function watchStatePath(): string {
  return siblingPath('watch.json');
}

/** Watch lists per project. A missing file watches nothing; a malformed one throws. */
function readProjects(): Record<string, ProjectWatch> {
  const file = watchStatePath();
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  return parseWatchFile(content, file);
}

export function readWatch(project: string): ProjectWatch {
  return readProjects()[project] ?? EMPTY_WATCH;
}

/**
 * Reads, changes and writes one project's list. The write lands through a rename, so an
 * agent reading at the same time never sees half a file.
 */
export function updateWatch(project: string, change: (list: ProjectWatch) => ProjectWatch): ProjectWatch {
  const projects = readProjects();
  const list = change(projects[project] ?? EMPTY_WATCH);
  const file = watchStatePath();
  const temporary = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify({ projects: { ...projects, [project]: list } }, null, 2)}\n`, 'utf-8');
  fs.renameSync(temporary, file);
  return list;
}
