import { describe, expect, it } from 'bun:test';
import { METHODS } from '../src/interfaces/Serve';
import {
  LineSplitter,
  OutboundQueue,
  ProtocolError,
  encodeLine,
  failure,
  parseRequest,
  push,
  serverEvent,
  success,
} from '../src/serve/protocol';

const bytes = (text: string) => new TextEncoder().encode(text);

function protocolError(fn: () => unknown): ProtocolError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProtocolError);
    return err as ProtocolError;
  }
  throw new Error('expected a ProtocolError');
}

describe('LineSplitter', () => {
  it('returns every complete line of a chunk', () => {
    expect(new LineSplitter().push(bytes('{"a":1}\n{"b":2}\n'))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('holds a partial line until its newline arrives', () => {
    const splitter = new LineSplitter();
    expect(splitter.push(bytes('{"a":'))).toEqual([]);
    expect(splitter.push(bytes('1}\n{"b"'))).toEqual(['{"a":1}']);
    expect(splitter.push(bytes(':2}\n'))).toEqual(['{"b":2}']);
  });

  it('keeps a multi-byte character whole when a chunk boundary cuts through it', () => {
    const line = bytes('{"t":"ação 😀"}\n');
    const cedilla = line.indexOf(0xc3);
    const splitter = new LineSplitter();
    expect(splitter.push(line.slice(0, cedilla + 1))).toEqual([]);
    expect(splitter.push(line.slice(cedilla + 1))).toEqual(['{"t":"ação 😀"}']);
  });

  it('keeps what it holds when the caller reuses the chunk buffer', () => {
    const splitter = new LineSplitter();
    const chunk = bytes('{"a":');
    splitter.push(chunk);
    chunk.fill(0x20);
    expect(splitter.push(bytes('1}\n'))).toEqual(['{"a":1}']);
  });

  it('skips blank lines and a trailing carriage return', () => {
    expect(new LineSplitter().push(bytes('\n  \n{"a":1}\r\n'))).toEqual(['{"a":1}']);
  });

  it('refuses a line past the limit, even before its newline arrives', () => {
    const splitter = new LineSplitter(8);
    expect(splitter.push(bytes('1234'))).toEqual([]);
    const err = protocolError(() => splitter.push(bytes('56789')));
    expect(err.kind).toBe('invalid_request');
    expect(err.message).toContain('8 bytes');
  });

  it('refuses bytes that are not UTF-8', () => {
    expect(protocolError(() => new LineSplitter().push(new Uint8Array([0xff, 0xfe, 0x0a]))).kind).toBe('invalid_request');
  });
});

describe('parseRequest', () => {
  it('reads id, method and params', () => {
    expect(parseRequest('{"id":3,"method":"items.get","params":{"id":16053}}')).toEqual({
      id: 3,
      method: 'items.get',
      params: { id: 16053 },
    });
  });

  it('defaults params to an empty object', () => {
    expect(parseRequest('{"id":0,"method":"status.get"}').params).toEqual({});
  });

  it('accepts every method of the contract', () => {
    for (const method of METHODS) expect(parseRequest(JSON.stringify({ id: 1, method })).method).toBe(method);
  });

  it.each([
    ['not JSON', '{ nope', 'valid JSON'],
    ['an array', '[1]', 'JSON object'],
    ['no id', '{"method":"hello"}', '"id"'],
    ['a fractional id', '{"id":1.5,"method":"hello"}', '"id"'],
    ['a negative id', '{"id":-1,"method":"hello"}', '"id"'],
    ['a string id', '{"id":"1","method":"hello"}', '"id"'],
  ])('refuses %s without an id to answer', (_case, line, text) => {
    const err = protocolError(() => parseRequest(line));
    expect(err.kind).toBe('invalid_request');
    expect(err.id).toBeNull();
    expect(err.message).toContain(text);
  });

  it('refuses an unknown method, answering its id and listing the methods', () => {
    const err = protocolError(() => parseRequest('{"id":7,"method":"items.delete"}'));
    expect(err.id).toBe(7);
    expect(err.message).toContain('"items.delete"');
    expect(err.hint).toContain('items.setState');
  });

  it('refuses params that are not an object', () => {
    const err = protocolError(() => parseRequest('{"id":2,"method":"items.get","params":[16053]}'));
    expect(err.id).toBe(2);
    expect(err.message).toContain('"params"');
  });
});

describe('OutboundQueue', () => {
  /** A socket that takes at most `budget` bytes until drained. */
  function slowSocket(budget: number) {
    const received: number[] = [];
    let left = budget;
    return {
      received,
      drain(next: number) {
        left = next;
      },
      write(bytes: Uint8Array) {
        const n = Math.min(left, bytes.length);
        received.push(...bytes.subarray(0, n));
        left -= n;
        return n;
      },
    };
  }

  it('keeps the rest of a partial write and sends it on the next flush, in order', () => {
    const socket = slowSocket(3);
    const queue = new OutboundQueue(b => socket.write(b), 100);
    queue.enqueue(bytes('abcdef'));
    queue.enqueue(bytes('gh'));
    expect(String.fromCharCode(...socket.received)).toBe('abc');
    expect(queue.pending).toBe(5);

    socket.drain(100);
    queue.flush();
    expect(String.fromCharCode(...socket.received)).toBe('abcdefgh');
    expect(queue.pending).toBe(0);
  });

  it('refuses to grow past the limit, so a client that stopped reading cannot exhaust memory', () => {
    const queue = new OutboundQueue(() => 0, 10);
    expect(queue.enqueue(bytes('123456'))).toBe(true);
    expect(queue.enqueue(bytes('789012'))).toBe(false);
    expect(queue.pending).toBe(6);
  });

  it('drops everything once the socket reports it is closed', () => {
    const queue = new OutboundQueue(() => -1, 100);
    queue.enqueue(bytes('abc'));
    expect(queue.pending).toBe(0);
  });
});

describe('encodeLine', () => {
  const decode = (line: Uint8Array) => new TextDecoder().decode(line);

  it('ends every message with exactly one newline, even when a string holds newlines', () => {
    const text = decode(encodeLine(success(1, { title: 'a\nb\r\nc' })));
    expect(text.endsWith('\n')).toBe(true);
    expect(text.indexOf('\n')).toBe(text.length - 1);
    expect(JSON.parse(text)).toEqual({ id: 1, result: { title: 'a\nb\r\nc' } });
  });

  it('round-trips through the splitter', () => {
    const messages = [
      success(1, { ok: true }),
      failure(null, { kind: 'invalid_request', message: 'bad' }),
      push('s1', { total: 2 }),
      serverEvent('status', { auth: 'needs_login' }),
    ];
    const stream = messages.map(encodeLine);
    const splitter = new LineSplitter();
    const lines = stream.flatMap(chunk => splitter.push(chunk));
    expect(lines.map(line => JSON.parse(line))).toEqual(messages);
  });
});
