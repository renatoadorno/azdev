import * as fs from 'fs';
import * as path from 'path';
import { siblingPath } from './config';

/** inbox.json lives next to config.json, so AZDEV_CONFIG_PATH isolates it too. */
export function inboxStatePath(): string {
  return siblingPath('inbox.json');
}

/** Last check per project, as ISO instants. A missing file is a first check. */
function readLastChecks(): Record<string, string> {
  let content: string;
  try {
    content = fs.readFileSync(inboxStatePath(), 'utf-8');
  } catch {
    return {};
  }
  try {
    const lastCheck = JSON.parse(content)?.lastCheck;
    return lastCheck && typeof lastCheck === 'object' ? lastCheck : {};
  } catch (err) {
    console.error(`Warning: ${inboxStatePath()} is not valid JSON (${(err as Error).message}); treating this as a first check.`);
    return {};
  }
}

export function readLastCheck(project: string): string | undefined {
  return readLastChecks()[project];
}

export function saveLastCheck(project: string, at: Date): void {
  const file = inboxStatePath();
  const lastCheck = { ...readLastChecks(), [project]: at.toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ lastCheck }, null, 2)}\n`, 'utf-8');
}
