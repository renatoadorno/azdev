import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Meta } from '../interfaces/Serve';
import type { RawItem } from '../interfaces/Sync';

/** Bump when the shape changes; an older snapshot is then ignored, not misread. */
export const SNAPSHOT_SCHEMA = 1;

/** What survives a restart: no description, comment or credential, only card fields and metadata. */
export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  orgUrl: string;
  project: string;
  savedAt: string;
  syncedAt: string | null;
  fullSyncedAt: string | null;
  meta: Meta;
  fields: string[];
  items: RawItem[];
}

/** One file per organization and project. */
export function snapshotPath(dir: string, orgUrl: string, project: string): string {
  const key = createHash('sha1').update(`${orgUrl}\n${project}`).digest('hex').slice(0, 12);
  return path.join(dir, `snapshot-${key}.json`);
}

export function writeSnapshot(file: string, snapshot: Snapshot): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function isRawItem(value: unknown): value is RawItem {
  const item = value as Partial<RawItem> | null;
  return (
    typeof item === 'object' &&
    item !== null &&
    Number.isSafeInteger(item.id) &&
    Number.isSafeInteger(item.rev) &&
    typeof item.fields === 'object' &&
    item.fields !== null
  );
}

/** The snapshot of this organization and project, or null when missing, unreadable or of another shape. */
export function readSnapshot(file: string, expected: { orgUrl: string; project: string }): Snapshot | null {
  let raw: Partial<Snapshot>;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
  if (
    raw?.schema !== SNAPSHOT_SCHEMA ||
    raw.orgUrl !== expected.orgUrl ||
    raw.project !== expected.project ||
    !Array.isArray(raw.items) ||
    !Array.isArray(raw.fields) ||
    !Array.isArray(raw.meta?.types) ||
    !Array.isArray(raw.meta?.sprints) ||
    typeof raw.meta?.me?.id !== 'string'
  ) {
    return null;
  }
  return { ...(raw as Snapshot), items: raw.items.filter(isRawItem) };
}
