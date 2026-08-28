import { spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Restores every environment variable a test touched. Leaking a mutated global
 * env is the classic way one test silently decides the outcome of the next.
 */
export function createEnvGuard() {
  const saved = new Map<string, string | undefined>();

  return {
    set(name: string, value: string | undefined) {
      if (!saved.has(name)) saved.set(name, process.env[name]);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    },
    restore() {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      saved.clear();
    },
  };
}

const tempDirs: string[] = [];

/** Creates an isolated config file and returns its path. Pass null for "no file". */
export function makeTempConfig(contents: Record<string, unknown> | string | null, mode = 0o600): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azdev-test-'));
  tempDirs.push(dir);

  const file = path.join(dir, 'config.json');
  if (contents !== null) {
    fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
    fs.chmodSync(file, mode);
  }
  return file;
}

export function cleanupTempConfigs() {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function readConfigFile(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export function fileMode(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

export class ExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

/** Turns process.exit into a throw so exit paths are observable instead of fatal. */
export function captureExit() {
  return spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);
}

export function captureStderr() {
  const lines: string[] = [];
  const spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return {
    spy,
    lines,
    text: () => lines.join('\n'),
  };
}
