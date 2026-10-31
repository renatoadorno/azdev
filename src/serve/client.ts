import type { Socket } from 'bun';
import {
  PROTOCOL_VERSION,
  type HelloResult,
  type Method,
  type MethodMap,
  type Push,
  type ServeError,
  type ServerEvent,
} from '../interfaces/Serve';
import { LineSplitter, OutboundQueue, encodeLine } from './protocol';

/** A failure the daemon reported, or the connection to it failing. */
export class DaemonError extends Error {
  constructor(readonly error: ServeError) {
    super(error.message);
    this.name = 'DaemonError';
  }

  get kind() {
    return this.error.kind;
  }
}

export interface DaemonClient {
  readonly hello: HelloResult;
  readonly closed: Promise<void>;
  call<M extends Method>(method: M, params?: MethodMap[M]['params']): Promise<MethodMap[M]['result']>;
  onPush(listener: (push: Push) => void): void;
  onEvent(listener: (event: ServerEvent) => void): void;
  close(): void;
}

export interface ConnectOptions {
  client?: string;
  /** Per call. */
  timeoutMs?: number;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: DaemonError): void;
  timer: Timer;
}

/** Connects to the daemon on 127.0.0.1 and says hello; throws DaemonError when it cannot. */
export async function connectDaemon(target: { port: number; token: string }, options: ConnectOptions = {}): Promise<DaemonClient> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pending = new Map<number, Pending>();
  const pushListeners: Array<(push: Push) => void> = [];
  const eventListeners: Array<(event: ServerEvent) => void> = [];
  // The daemon's answers can be large (a watched list); only requests are size-limited.
  const splitter = new LineSplitter(Number.MAX_SAFE_INTEGER);
  let out: OutboundQueue | undefined;
  let isClosed = false;
  let nextId = 1;
  let markClosed = () => {};
  const closed = new Promise<void>(resolve => (markClosed = resolve));

  function failAll(error: ServeError) {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new DaemonError(error));
    }
    pending.clear();
  }

  function dispatch(line: string) {
    const message = JSON.parse(line);
    if (typeof message.sub === 'string') {
      for (const listener of pushListeners) listener(message);
      return;
    }
    if (typeof message.event === 'string') {
      for (const listener of eventListeners) listener(message);
      return;
    }
    if (message.id === null && message.error) {
      failAll(message.error);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new DaemonError(message.error));
    else waiter.resolve(message.result);
  }

  let socket: Socket<undefined>;
  try {
    socket = await Bun.connect<undefined>({
      hostname: '127.0.0.1',
      port: target.port,
      socket: {
        data(_socket, chunk) {
          for (const line of splitter.push(chunk)) dispatch(line);
        },
        drain() {
          out?.flush();
        },
        close() {
          isClosed = true;
          failAll({ kind: 'offline', message: 'azdev serve closed the connection' });
          markClosed();
        },
      },
    });
  } catch (err) {
    throw new DaemonError({
      kind: 'offline',
      message: `Cannot reach azdev serve on port ${target.port}: ${(err as Error).message}`,
      hint: "Start it with 'azdev serve start'.",
    });
  }
  out = new OutboundQueue(bytes => socket.write(bytes), Number.MAX_SAFE_INTEGER);

  function call<M extends Method>(method: M, params?: MethodMap[M]['params']): Promise<MethodMap[M]['result']> {
    if (isClosed) return Promise.reject(new DaemonError({ kind: 'offline', message: 'The connection to azdev serve is closed' }));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new DaemonError({ kind: 'offline', message: `${method} got no answer in ${timeoutMs} ms` }));
      }, timeoutMs);
      pending.set(id, { resolve: resolve as (result: unknown) => void, reject, timer });
      out!.enqueue(encodeLine({ id, method, params: (params ?? {}) as Record<string, unknown> }));
    });
  }

  let hello: HelloResult;
  try {
    hello = await call('hello', { token: target.token, proto: PROTOCOL_VERSION, client: options.client });
  } catch (err) {
    socket.end();
    throw err;
  }

  return {
    hello,
    closed,
    call,
    onPush: listener => pushListeners.push(listener),
    onEvent: listener => eventListeners.push(listener),
    close: () => socket.end(),
  };
}
