import {
  PROTOCOL_VERSION,
  type HelloResult,
  type Method,
  type MethodMap,
  type Request,
  type ServerMessage,
  type Status,
} from '../interfaces/Serve';
import { toServeError } from './errors';
import { ProtocolError, failure, parseRequest, success } from './protocol';
import { tokensEqual } from './runtime';

/** The connection a handler answers on: watch subscriptions push on it and clean up with it. */
export interface Connection {
  readonly id: number;
  send(message: ServerMessage): void;
  /** Flushes what is queued, then closes. */
  close(): void;
  /** Runs once when the connection goes, however it goes. */
  onClose(cleanup: () => void): void;
}

export type Handler<M extends Method> = (
  params: MethodMap[M]['params'],
  conn: Connection,
) => Promise<MethodMap[M]['result']> | MethodMap[M]['result'];

export type Handlers = { [M in Exclude<Method, 'hello'>]?: Handler<M> };

export interface SessionOptions {
  token: string;
  version: string;
  handlers: Handlers;
  status(): Status;
  /** Runs before hello answers — the daemon re-reads a credential stored after it started. */
  beforeHello?(): Promise<void> | void;
}

/** One connection's protocol: only hello until it succeeds, then the handlers. */
export class Session {
  private authed = false;

  constructor(
    private readonly conn: Connection,
    private readonly options: SessionOptions,
  ) {}

  get isAuthed(): boolean {
    return this.authed;
  }

  async receive(line: string): Promise<void> {
    let request: Request;
    try {
      request = parseRequest(line);
    } catch (err) {
      this.conn.send(failure(err instanceof ProtocolError ? err.id : null, toServeError(err)));
      if (!this.authed) this.conn.close();
      return;
    }

    if (!this.authed) return this.hello(request);
    if (request.method === 'hello') {
      this.conn.send(failure(request.id, { kind: 'invalid_request', message: 'hello was already accepted on this connection' }));
      return;
    }

    const handler = this.options.handlers[request.method] as Handler<Method> | undefined;
    if (!handler) {
      this.conn.send(failure(request.id, { kind: 'invalid_request', message: `Method ${request.method} is not available in this version` }));
      return;
    }
    try {
      this.conn.send(success(request.id, await handler(request.params as never, this.conn)));
    } catch (err) {
      this.conn.send(failure(request.id, toServeError(err)));
    }
  }

  private async hello(request: Request): Promise<void> {
    if (request.method !== 'hello' || !tokensEqual(request.params.token, this.options.token)) {
      this.conn.send(
        failure(request.id, {
          kind: 'unauthorized',
          message: 'The first message must be hello with the token from serve.json',
        }),
      );
      this.conn.close();
      return;
    }
    if (request.params.proto !== PROTOCOL_VERSION) {
      this.conn.send(
        failure(request.id, {
          kind: 'invalid_request',
          message: `Protocol ${String(request.params.proto)} is not supported; this daemon speaks ${PROTOCOL_VERSION}`,
          hint: "Update the client, or run 'azdev serve start' from the matching azdev version.",
        }),
      );
      this.conn.close();
      return;
    }
    // Set before awaiting: a request pipelined right after hello must not be refused.
    this.authed = true;
    await this.options.beforeHello?.();
    const result: HelloResult = { proto: PROTOCOL_VERSION, version: this.options.version, status: this.options.status() };
    this.conn.send(success(request.id, result));
  }
}
