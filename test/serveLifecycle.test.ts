import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * `azdev serve` as real processes: lock, serve.json, start/stop/status, idle exit.
 * AZDEV_PAT is set, so no keychain lookup, and nothing here makes the daemon call
 * Azure DevOps.
 */
const ENTRY = path.join(import.meta.dir, '..', 'src', 'cli', 'index.ts');
const SLOW = { timeout: 20_000 };

let dir: string;
let env: Record<string, string | undefined>;
const pids = new Set<number>();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azdev-serve-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ orgUrl: 'https://dev.azure.com/acme', project: 'Demo' }), { mode: 0o600 });
  env = {
    ...process.env,
    AZDEV_CONFIG_PATH: path.join(dir, 'config.json'),
    AZDEV_CACHE_DIR: path.join(dir, 'cache'),
    AZDEV_PAT: 'fake-token',
  };
});

afterEach(() => {
  const info = readInfo();
  if (info) pids.add(info.pid);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  pids.clear();
  fs.rmSync(dir, { recursive: true, force: true });
});

function spawnAzdev(args: string[]) {
  const proc = Bun.spawn([process.execPath, ENTRY, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
  pids.add(proc.pid);
  return proc;
}

async function azdev(args: string[]) {
  const proc = spawnAzdev(args);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
}

function readInfo(): { pid: number; port: number; token: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'serve.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await Bun.sleep(25);
  }
}

describe('azdev serve (foreground)', () => {
  it('writes serve.json 0600, refuses a second daemon with 75, and a kill -9 leaves nothing stale', async () => {
    const daemon = spawnAzdev(['serve']);
    await waitFor(() => readInfo()?.pid === daemon.pid);
    expect(fs.statSync(path.join(dir, 'serve.json')).mode & 0o777).toBe(0o600);

    const second = await azdev(['serve']);
    expect(second.code).toBe(75);
    expect(second.err).toContain('already running');

    const status = await azdev(['serve', 'status', '--json']);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.out)).toMatchObject({ running: true, pid: daemon.pid, project: 'Demo', auth: { state: 'unknown', source: 'env' } });
    expect(status.out).not.toContain(readInfo()!.token);

    daemon.kill('SIGKILL');
    await daemon.exited;
    const after = await azdev(['serve', 'status', '--json']);
    expect(JSON.parse(after.out)).toEqual({ running: false });
    expect(readInfo()).toBeNull();
  }, SLOW);

  it('exits by itself after --idleExit with no client, removing serve.json', async () => {
    const daemon = spawnAzdev(['serve', '--idleExit', '1s']);
    await waitFor(() => readInfo()?.pid === daemon.pid);
    expect(await daemon.exited).toBe(0);
    expect(readInfo()).toBeNull();
    expect(await new Response(daemon.stderr).text()).toContain('"reason":"idle"');
  }, SLOW);

  it('exits 2 without a config file, like every other command', async () => {
    fs.rmSync(path.join(dir, 'config.json'));
    const result = await azdev(['serve']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('not found');
    expect(readInfo()).toBeNull();
  }, SLOW);

  it('exits 1 on an unknown action or a bad flag, before starting anything', async () => {
    expect((await azdev(['serve', 'restart'])).code).toBe(1);
    expect((await azdev(['serve', '--idleExit', '90'])).code).toBe(1);
    expect((await azdev(['serve', '--port', '70000'])).code).toBe(1);
    expect(readInfo()).toBeNull();
  }, SLOW);
});

describe('azdev serve start | stop | status', () => {
  it('starts in the background once, then stops and removes serve.json', async () => {
    const first = await azdev(['serve', 'start', '--json']);
    expect(first.code).toBe(0);
    const started = JSON.parse(first.out);
    expect(started).toMatchObject({ started: true, project: 'Demo' });
    expect(alive(started.pid)).toBe(true);
    pids.add(started.pid);
    expect(fs.existsSync(path.join(dir, 'cache', 'serve.log'))).toBe(true);

    const again = JSON.parse((await azdev(['serve', 'start', '--json'])).out);
    expect(again).toMatchObject({ started: false, pid: started.pid });

    const stopped = await azdev(['serve', 'stop', '--json']);
    expect(JSON.parse(stopped.out)).toEqual({ stopped: true, pid: started.pid });
    await waitFor(() => !alive(started.pid));
    expect(readInfo()).toBeNull();

    expect(JSON.parse((await azdev(['serve', 'stop', '--json'])).out)).toEqual({ stopped: false });
  }, SLOW);
});
