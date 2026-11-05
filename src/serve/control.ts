import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Status } from '../interfaces/Serve';
import { connectDaemon } from './client';
import { cacheDir, isServeLockHeld, readServeInfo, serveInfoPath, type ServeInfo } from './runtime';

export type DaemonState = { running: false } | { running: true; info: ServeInfo; status: Status };

const POLL_MS = 50;

export function serveLogPath(): string {
  return path.join(cacheDir(), 'serve.log');
}

/** The command that runs this same azdev: the compiled binary, or bun with the entry script. */
export function selfCommand(): string[] {
  // A compiled binary runs its entry from Bun's virtual filesystem.
  return Bun.main.startsWith('/$bunfs/') ? [process.execPath] : [process.execPath, Bun.main];
}

/** Whether a daemon answers, asked over the protocol itself; a file left by a dead one is removed. */
export async function daemonState(): Promise<DaemonState> {
  const info = readServeInfo();
  if (info) {
    try {
      const client = await connectDaemon(info, { client: 'azdev-cli', timeoutMs: 3000 });
      client.close();
      return { running: true, info, status: client.hello.status };
    } catch {
      // Not answering: either it died (lock free) or it is still starting (lock held).
    }
  }
  if (info && !isServeLockHeld()) fs.rmSync(serveInfoPath(), { force: true });
  return { running: false };
}

export interface StartOptions {
  command: string[];
  version: string;
  port: string;
  idleExit: string;
  readyTimeoutMs?: number;
}

export interface StartResult {
  started: boolean;
  info: ServeInfo;
  status: Status;
}

/**
 * Starts the daemon in the background unless one of the same version answers;
 * one of another version (a new build was installed) is stopped first. Returns
 * once the new one answers hello, without waiting for any sync.
 */
export async function startDaemon(options: StartOptions): Promise<StartResult> {
  const current = await daemonState();
  if (current.running && current.status.version === options.version) {
    return { started: false, info: current.info, status: current.status };
  }
  if (current.running) await stopDaemon();

  const logFile = serveLogPath();
  fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
  const logFd = fs.openSync(logFile, 'w', 0o600);
  const [bin, ...rest] = options.command;
  const child = spawn(bin!, [...rest, 'serve', '--port', options.port, '--idleExit', options.idleExit], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  let exitCode: number | null = null;
  child.on('exit', code => (exitCode = code ?? -1));
  child.unref();

  const deadline = Date.now() + (options.readyTimeoutMs ?? 10_000);
  while (Date.now() < deadline) {
    const info = readServeInfo();
    if (info && info.pid === child.pid) {
      try {
        const client = await connectDaemon(info, { client: 'azdev-cli', timeoutMs: 2000 });
        client.close();
        return { started: true, info, status: client.hello.status };
      } catch {
        // Listening but not answering yet; try again.
      }
    }
    if (exitCode !== null) throw new Error(`azdev serve exited with code ${exitCode}; see ${logFile}`);
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`azdev serve did not answer within ${(options.readyTimeoutMs ?? 10_000) / 1000} s; see ${logFile}`);
}

/** SIGTERM to the daemon that answers, then waits for its lock to drop. */
export async function stopDaemon(timeoutMs = 5000): Promise<{ stopped: boolean; pid?: number }> {
  const current = await daemonState();
  if (!current.running) return { stopped: false };
  const pid = current.status.pid;
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isServeLockHeld()) return { stopped: true, pid };
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`azdev serve (pid ${pid}) did not stop within ${timeoutMs / 1000} s`);
}
