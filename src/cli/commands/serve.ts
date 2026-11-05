import { defineCommand } from 'citty';
import type { Status } from '../../interfaces/Serve';
import { daemonState, selfCommand, startDaemon, stopDaemon, type DaemonState, type StartResult } from '../../serve/control';
import { runDaemon } from '../../serve/daemon';
import { globalOptions, runCommand } from '../command';
import { format } from '../formatters/index';
import { failUsage, parseDuration } from '../parsers';
import { VERSION } from '../version';

/** `azdev serve <action>`; a positional, because citty runs a parent's `run` after its subcommand. */
export const SERVE_ACTIONS = ['start', 'stop', 'status'] as const;
type ServeAction = (typeof SERVE_ACTIONS)[number];

function parseAction(value: unknown): ServeAction | undefined {
  if (value === undefined || value === '') return undefined;
  if (!(SERVE_ACTIONS as readonly unknown[]).includes(value)) {
    failUsage(`Unknown serve action '${String(value)}'. Use: ${SERVE_ACTIONS.join(', ')}, or none to run in the foreground`);
  }
  return value as ServeAction;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) failUsage(`Invalid --port: ${value}`);
  return port;
}

/** What `start` and `status` print: never the token, which only serve.json carries. */
function describe(status: Status) {
  const { version, pid, startedAt, project, auth, cache, sync, clients } = status;
  return { version, pid, startedAt, project, auth, cache, sync, clients };
}

function startSummary({ started, info, status }: StartResult) {
  return { started, port: info.port, ...describe(status) };
}

function stateSummary(state: DaemonState) {
  return state.running ? { running: true, port: state.info.port, ...describe(state.status) } : { running: false };
}

const DEFAULT_IDLE_EXIT = '2h';

export default defineCommand({
  meta: {
    name: 'serve',
    description:
      'Local daemon with a cache, for the Herdr mod (NDJSON over TCP on 127.0.0.1). No action runs it in the foreground; start, stop and status manage it in the background',
  },
  args: {
    json: globalOptions.json,
    markdown: globalOptions.markdown,
    action: {
      type: 'positional',
      required: false,
      description: 'start | stop | status — none runs the daemon in the foreground',
    },
    port: { type: 'string', description: 'TCP port on 127.0.0.1 (default: any free port)' },
    idleExit: {
      type: 'string',
      description: `Exit after this long with no client and no request: 30m, 2h, 0 for never (default ${DEFAULT_IDLE_EXIT})`,
    },
  },
  async run({ args }) {
    const action = parseAction(args.action);
    const port = parsePort(args.port);
    const idleExit = args.idleExit ?? DEFAULT_IDLE_EXIT;
    const idleExitMs = parseDuration(idleExit, '--idleExit');

    await runCommand(async () => {
      if (!action) {
        await runDaemon({ port, idleExitMs, version: VERSION });
        return;
      }
      const result =
        action === 'start'
          ? startSummary(await startDaemon({ command: selfCommand(), version: VERSION, port: String(port), idleExit }))
          : action === 'stop'
            ? await stopDaemon()
            : stateSummary(await daemonState());
      console.log(format(result, args));
    });
  },
});
