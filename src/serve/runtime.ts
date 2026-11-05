import { dlopen, FFIType } from 'bun:ffi';
import { randomBytes, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { siblingPath } from '../cli/config';

/** Exit code of a second `azdev serve` while one is running (EX_TEMPFAIL). */
export const EXIT_ALREADY_RUNNING = 75;

/** How clients reach the running daemon: port and token. The Herdr mod reads this file. */
export function serveInfoPath(): string {
  return siblingPath('serve.json');
}

export function serveLockPath(): string {
  return siblingPath('serve.lock');
}

/** Disposable files (snapshot, log): AZDEV_CACHE_DIR, else $XDG_CACHE_HOME/azdev, else ~/.cache/azdev. */
export function cacheDir(): string {
  const override = process.env.AZDEV_CACHE_DIR;
  if (override) return override;
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
  return path.join(base, 'azdev');
}

export interface ServeInfo {
  pid: number;
  port: number;
  token: string;
  version: string;
  proto: number;
  startedAt: string;
}

function isServeInfo(value: unknown): value is ServeInfo {
  const v = value as Partial<ServeInfo> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isInteger(v.pid) &&
    Number.isInteger(v.port) &&
    typeof v.token === 'string' &&
    typeof v.version === 'string' &&
    typeof v.proto === 'number' &&
    typeof v.startedAt === 'string'
  );
}

export function writeServeInfo(info: ServeInfo): void {
  const file = serveInfoPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  // Renamed into place: a client reading it never sees half a file.
  fs.renameSync(tmp, file);
}

/** The running daemon's info, or null when the file is missing or not one azdev wrote. */
export function readServeInfo(): ServeInfo | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(serveInfoPath(), 'utf-8'));
    return isServeInfo(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Removes serve.json only while it still names this pid: a newer daemon may already own it. */
export function removeServeInfo(pid: number): void {
  if (readServeInfo()?.pid !== pid) return;
  fs.rmSync(serveInfoPath(), { force: true });
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time comparison, so the time a refusal takes says nothing about the token. */
export function tokensEqual(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ServeLock {
  release(): void;
}

type Flock = (fd: number, operation: number) => number;

let flockFn: Flock | null | undefined;

function loadFlock(): Flock | null {
  if (flockFn !== undefined) return flockFn;
  const libc = process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6';
  try {
    const { symbols } = dlopen(libc, { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
    flockFn = symbols.flock as Flock;
  } catch {
    flockFn = null;
  }
  return flockFn;
}

/**
 * Takes the one-daemon-per-user lock, or returns null while another process
 * holds it. flock lives on the open file, so the kernel drops it when the holder
 * dies, even on kill -9: no stale lock to clean and no pid to guess.
 */
export function acquireServeLock(): ServeLock | null {
  const LOCK_EX = 2;
  const LOCK_NB = 4;
  const file = serveLockPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'a', 0o600);
  const release = () => fs.closeSync(fd);

  const flock = loadFlock();
  if (!flock) {
    console.error('Warning: flock is unavailable here; a second azdev serve would not be refused.');
    return { release };
  }
  if (flock(fd, LOCK_EX | LOCK_NB) !== 0) {
    release();
    return null;
  }
  return { release };
}

/** True while some process holds the lock — the reliable "is a daemon alive" check. */
export function isServeLockHeld(): boolean {
  const lock = acquireServeLock();
  if (!lock) return true;
  lock.release();
  return false;
}
