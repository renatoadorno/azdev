import {
  METHODS,
  type ErrorKind,
  type EventType,
  type Failure,
  type Method,
  type Push,
  type Request,
  type ServeError,
  type ServerEvent,
  type ServerMessage,
  type Success,
} from '../interfaces/Serve';

/** Largest request line accepted; a longer one closes the connection. */
export const MAX_REQUEST_BYTES = 256 * 1024;

const NEWLINE = 0x0a;

/** A message the daemon refuses, with the `id` to answer when it was readable. */
export class ProtocolError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly id: number | null = null,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/**
 * Cuts a byte stream into lines. It splits on 0x0A before decoding, which keeps a
 * multi-byte UTF-8 character whole even when it straddles two chunks: no byte of
 * such a character is ever 0x0A. Blank lines are skipped.
 */
export class LineSplitter {
  private parts: Uint8Array[] = [];
  private size = 0;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly maxBytes = MAX_REQUEST_BYTES) {}

  push(chunk: Uint8Array): string[] {
    const lines: string[] = [];
    let start = 0;
    let newline: number;
    while ((newline = chunk.indexOf(NEWLINE, start)) !== -1) {
      this.append(chunk.subarray(start, newline));
      const line = this.decode(this.take()).trim();
      if (line) lines.push(line);
      start = newline + 1;
    }
    // Copied: the runtime may reuse the chunk's buffer after the callback returns.
    if (start < chunk.length) this.append(chunk.slice(start));
    return lines;
  }

  private append(bytes: Uint8Array): void {
    this.size += bytes.length;
    if (this.size > this.maxBytes) {
      throw new ProtocolError('invalid_request', `Line longer than ${this.maxBytes} bytes`);
    }
    this.parts.push(bytes);
  }

  private take(): Uint8Array {
    const parts = this.parts;
    const size = this.size;
    this.parts = [];
    this.size = 0;
    if (parts.length === 1) return parts[0]!;
    const line = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      line.set(part, at);
      at += part.length;
    }
    return line;
  }

  private decode(bytes: Uint8Array): string {
    try {
      return this.decoder.decode(bytes);
    } catch {
      throw new ProtocolError('invalid_request', 'Line is not valid UTF-8');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMethod(value: unknown): value is Method {
  return typeof value === 'string' && (METHODS as readonly string[]).includes(value);
}

/** One request line → a request with a known method and an object for params. */
export function parseRequest(line: string): Request {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new ProtocolError('invalid_request', 'Line is not valid JSON');
  }
  if (!isRecord(raw)) throw new ProtocolError('invalid_request', 'A request is a JSON object');

  const { id, method } = raw;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
    throw new ProtocolError('invalid_request', '"id" must be a non-negative integer');
  }
  if (!isMethod(method)) {
    throw new ProtocolError('invalid_request', `Unknown method ${JSON.stringify(method)}`, id, `Methods: ${METHODS.join(', ')}`);
  }
  const params = raw.params ?? {};
  if (!isRecord(params)) throw new ProtocolError('invalid_request', '"params" must be an object', id);
  return { id, method, params };
}

export function success<T>(id: number, result: T): Success<T> {
  return { id, result };
}

export function failure(id: number | null, error: ServeError): Failure {
  return { id, error };
}

export function push<T>(sub: string, result: T): Push<T> {
  return { sub, result };
}

export function serverEvent<T>(event: EventType, data: T): ServerEvent<T> {
  return { event, data };
}

const encoder = new TextEncoder();

/** One message as a line. JSON escapes newlines inside strings, so the only 0x0A is the terminator. */
export function encodeLine(message: ServerMessage | Request): Uint8Array {
  return encoder.encode(`${JSON.stringify(message)}\n`);
}

/** Bytes a socket accepted, or a negative number once it is closed. */
export type SocketWrite = (bytes: Uint8Array) => number;

/**
 * Bytes waiting for the socket. A socket write may take only part of a large
 * line (seen with 1 MB); the rest waits here until `drain` calls flush again.
 */
export class OutboundQueue {
  private chunks: Uint8Array[] = [];
  private queued = 0;

  constructor(
    private readonly write: SocketWrite,
    private readonly maxBytes: number,
  ) {}

  get pending(): number {
    return this.queued;
  }

  /** Queues and flushes; false when the backlog would pass the limit (a client that stopped reading). */
  enqueue(bytes: Uint8Array): boolean {
    if (this.queued + bytes.length > this.maxBytes) return false;
    this.chunks.push(bytes);
    this.queued += bytes.length;
    this.flush();
    return true;
  }

  flush(): void {
    while (this.chunks.length) {
      const chunk = this.chunks[0]!;
      const written = this.write(chunk);
      if (written < 0) {
        this.chunks = [];
        this.queued = 0;
        return;
      }
      this.queued -= written;
      if (written < chunk.length) {
        this.chunks[0] = chunk.subarray(written);
        return;
      }
      this.chunks.shift();
    }
  }
}
