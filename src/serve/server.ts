import type { Socket } from 'bun';
import type { ServerMessage } from '../interfaces/Serve';
import { toServeError } from './errors';
import { LineSplitter, OutboundQueue, encodeLine, failure } from './protocol';
import { Session, type Connection, type SessionOptions } from './session';

/** Bytes a client may send before its hello is accepted. */
export const MAX_PRE_HELLO_BYTES = 64 * 1024;
/** Backlog past which a client that stopped reading is dropped. */
export const MAX_OUTBOUND_BYTES = 16 * 1024 * 1024;
export const HELLO_TIMEOUT_MS = 2000;

export interface ServerOptions extends SessionOptions {
  port?: number;
  helloTimeoutMs?: number;
  /** Every request line and every disconnect: what keeps the daemon from exiting idle. */
  onActivity?(): void;
  log?(event: string, fields?: Record<string, unknown>): void;
}

export interface RunningServer {
  port: number;
  clients(): number;
  stop(): void;
}

interface ConnState {
  conn: Connection;
  session: Session;
  splitter: LineSplitter;
  out: OutboundQueue;
  preHelloBytes: number;
  closing: boolean;
  closed: boolean;
  cleanups: Array<() => void>;
  helloTimer?: Timer;
}

/** Listens on 127.0.0.1 only; each connection gets its own Session. */
export function startServer(options: ServerOptions): RunningServer {
  const log = options.log ?? (() => {});
  const sockets = new Set<Socket<ConnState>>();
  let nextId = 1;

  function endWhenFlushed(socket: Socket<ConnState>) {
    const state = socket.data;
    if (state.closing && state.out.pending === 0) socket.end();
  }

  function createState(socket: Socket<ConnState>): ConnState {
    const state = {} as ConnState;
    const conn: Connection = {
      id: nextId++,
      send(message: ServerMessage) {
        if (state.closed) return;
        if (!state.out.enqueue(encodeLine(message))) {
          log('client-too-slow', { conn: conn.id, pending: state.out.pending });
          socket.terminate();
          return;
        }
        endWhenFlushed(socket);
      },
      close() {
        state.closing = true;
        endWhenFlushed(socket);
      },
      onClose(cleanup) {
        if (state.closed) cleanup();
        else state.cleanups.push(cleanup);
      },
    };
    Object.assign(state, {
      conn,
      session: new Session(conn, options),
      splitter: new LineSplitter(),
      out: new OutboundQueue(bytes => socket.write(bytes), MAX_OUTBOUND_BYTES),
      preHelloBytes: 0,
      closing: false,
      closed: false,
      cleanups: [],
    });
    return state;
  }

  const listener = Bun.listen<ConnState>({
    hostname: '127.0.0.1',
    port: options.port ?? 0,
    socket: {
      open(socket) {
        socket.data = createState(socket);
        sockets.add(socket);
        socket.data.helloTimer = setTimeout(() => {
          if (!socket.data.session.isAuthed) socket.end();
        }, options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
      },
      data(socket, chunk) {
        const state = socket.data;
        if (state.closing) return;
        if (!state.session.isAuthed) {
          state.preHelloBytes += chunk.length;
          if (state.preHelloBytes > MAX_PRE_HELLO_BYTES) {
            log('pre-hello-overflow', { conn: state.conn.id });
            socket.end();
            return;
          }
        }
        let lines: string[];
        try {
          lines = state.splitter.push(chunk);
        } catch (err) {
          state.conn.send(failure(null, toServeError(err)));
          state.conn.close();
          return;
        }
        for (const line of lines) {
          options.onActivity?.();
          void state.session.receive(line);
        }
      },
      drain(socket) {
        socket.data.out.flush();
        endWhenFlushed(socket);
      },
      close(socket) {
        const state = socket.data;
        state.closed = true;
        clearTimeout(state.helloTimer);
        sockets.delete(socket);
        for (const cleanup of state.cleanups.splice(0)) cleanup();
        options.onActivity?.();
      },
      error(socket, error) {
        log('socket-error', { conn: socket.data?.conn.id, message: error.message });
      },
    },
  });

  return {
    port: listener.port,
    clients: () => [...sockets].filter(s => s.data.session.isAuthed).length,
    stop() {
      for (const socket of sockets) socket.end();
      listener.stop(true);
    },
  };
}
