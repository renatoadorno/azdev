import * as fs from 'fs';
import { ConfigError, exitOnConfigError, readConfigFile, resolveCliConfig } from '../cli/config';
import { readWatch } from '../cli/watchState';
import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import { PROTOCOL_VERSION, type ServeError, type Status } from '../interfaces/Serve';
import { SyncService } from '../services/SyncService';
import { watchedIds } from '../services/watch';
import { SyncEngine } from './engine';
import { dataHandlers } from './handlers';
import {
  EXIT_ALREADY_RUNNING,
  acquireServeLock,
  cacheDir,
  generateToken,
  readServeInfo,
  removeServeInfo,
  writeServeInfo,
} from './runtime';
import { describeProtocol } from './schema';
import { startServer } from './server';
import { snapshotPath } from './snapshot';

export interface DaemonOptions {
  port: number;
  /** 0 keeps it up for good. */
  idleExitMs: number;
  version: string;
}

type AuthStatus = Status['auth'];

function credentialSource(config: AzureDevOpsConfig): AuthStatus['source'] {
  if (config.auth?.type === 'entra') return 'entra';
  const envVar = config.auth?.type === 'ntlm' || config.auth?.type === 'basic' ? 'AZDEV_PASSWORD' : 'AZDEV_PAT';
  return process.env[envVar] ? 'env' : 'keychain';
}

/**
 * The credential the daemon works with. A missing token does not stop it: it is
 * re-read on the next hello, so `azdev config set personalAccessToken` fixes a
 * running daemon without a restart.
 */
class Credentials {
  config: AzureDevOpsConfig | null = null;
  auth: AuthStatus = { state: 'unknown' };
  /** Moves on every successful load, so the engine knows to rebuild its client. */
  generation = 0;

  /** Throws only a config the daemon cannot start with (missing or invalid file). */
  async load(): Promise<void> {
    try {
      this.config = await resolveCliConfig();
      this.auth = { state: 'unknown', source: credentialSource(this.config) };
      this.generation++;
    } catch (err) {
      if (!(err instanceof ConfigError) || err.kind !== 'needs_login') throw err;
      this.config = null;
      this.auth = { state: 'needs_login', hint: err.hint };
    }
  }

  async retryIfMissing(): Promise<void> {
    if (this.auth.state !== 'needs_login') return;
    try {
      await this.load();
    } catch (err) {
      const reason = err instanceof ConfigError ? [err.message, err.hint].filter(Boolean).join('\n') : String(err);
      this.auth = { state: 'needs_login', hint: reason };
    }
  }

  markOk(): void {
    if (this.auth.state !== 'ok' && this.config) this.auth = { state: 'ok', source: credentialSource(this.config) };
  }

  /** A 401 from Azure DevOps: the next hello re-reads the credential. */
  markFailure(error: ServeError): void {
    if (error.kind === 'needs_login') this.auth = { state: 'needs_login', hint: error.hint };
  }

  /** The config to talk to Azure DevOps with, or the needs_login error a client can show. */
  require(): AzureDevOpsConfig {
    if (this.config) return this.config;
    throw new ConfigError('needs_login', ['No Azure DevOps credential.', ...(this.auth.hint ? [this.auth.hint] : [])]);
  }
}

/** Watched cards of the project; a malformed watch.json must not break the cache. */
function watched(project: string): number[] {
  try {
    return watchedIds(readWatch(project));
  } catch {
    return [];
  }
}

function log(event: string, fields: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}

/**
 * True once the compiled binary on disk is no longer the one running. Installing
 * a build does not restart the daemon, and a same-version rebuild would slip past
 * the version check in `serve start`. From source it never reports a change.
 */
function binaryWatcher(): () => boolean {
  if (!Bun.main.startsWith('/$bunfs/')) return () => false;
  const identity = () => {
    try {
      const { ino, mtimeMs, size } = fs.statSync(process.execPath);
      return `${ino}:${mtimeMs}:${size}`;
    } catch {
      return 'missing';
    }
  };
  const atStart = identity();
  return () => identity() !== atStart;
}

/** Runs the daemon until a signal or the idle limit; a second one exits 75. */
export async function runDaemon(options: DaemonOptions): Promise<void> {
  const acquired = acquireServeLock();
  if (!acquired) {
    const info = readServeInfo();
    console.error(`azdev serve is already running${info ? ` (pid ${info.pid}, port ${info.port})` : ''}.`);
    process.exit(EXIT_ALREADY_RUNNING);
  }
  const lock = acquired;

  const credentials = new Credentials();
  try {
    await credentials.load();
  } catch (err) {
    lock.release();
    exitOnConfigError(err);
  }

  const project = credentials.config?.project ?? readConfigFile()?.project ?? '';
  const startedAt = new Date().toISOString();
  const token = generateToken();
  let lastActivity = Date.now();

  let engine: SyncEngine | null = null;
  let engineGeneration = -1;
  /** Built on the first data request, from the snapshot; rebuilt client when the credential changes. */
  function requireEngine(): SyncEngine {
    const config = credentials.require();
    if (!engine) {
      engine = new SyncEngine({
        orgUrl: config.orgUrl,
        project: config.project,
        source: new SyncService(config),
        snapshotFile: snapshotPath(cacheDir(), config.orgUrl, config.project),
        watched: () => watched(config.project),
        onSuccess: () => credentials.markOk(),
        onError: error => credentials.markFailure(error),
        log,
      });
      engine.loadSnapshot();
    } else if (engineGeneration !== credentials.generation) {
      engine.setSource(new SyncService(config));
    }
    engineGeneration = credentials.generation;
    return engine;
  }

  const server = startServer({
    port: options.port,
    token,
    version: options.version,
    status: () => status(),
    handlers: {
      'status.get': () => status(),
      'schema.get': () => describeProtocol(),
      ...dataHandlers(requireEngine),
    },
    beforeHello: () => credentials.retryIfMissing(),
    onActivity: () => {
      lastActivity = Date.now();
    },
    log,
  });

  function status(): Status {
    return {
      version: options.version,
      proto: PROTOCOL_VERSION,
      pid: process.pid,
      startedAt,
      project,
      auth: credentials.auth,
      cache: engine?.cacheStatus() ?? { items: 0, syncedAt: null, fullSyncedAt: null, stale: false },
      sync: engine?.syncStatus() ?? { running: false, nextAt: null, backoffUntil: null, lastError: null },
      clients: server.clients(),
    };
  }

  // Loads the snapshot now (no network), so status shows the cache from the start.
  if (credentials.config) requireEngine();

  writeServeInfo({ pid: process.pid, port: server.port, token, version: options.version, proto: PROTOCOL_VERSION, startedAt });
  log('listening', { pid: process.pid, port: server.port, project, auth: credentials.auth.state, idleExitMs: options.idleExitMs });

  let stopping = false;
  function shutdown(reason: string) {
    if (stopping) return;
    stopping = true;
    log('stopping', { reason });
    engine?.saveSnapshot();
    server.stop();
    removeServeInfo(process.pid);
    lock.release();
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const BINARY_CHECK_MS = 30_000;
  const binaryReplaced = binaryWatcher();
  const every = options.idleExitMs > 0 ? Math.max(250, Math.min(BINARY_CHECK_MS, Math.floor(options.idleExitMs / 4))) : BINARY_CHECK_MS;
  setInterval(() => {
    if (server.clients() > 0) return;
    if (binaryReplaced()) shutdown('binary-replaced');
    else if (options.idleExitMs > 0 && Date.now() - lastActivity >= options.idleExitMs) shutdown('idle');
  }, every);
}
