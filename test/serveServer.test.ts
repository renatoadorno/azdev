import { afterEach, describe, expect, it } from 'bun:test';
import type { Status } from '../src/interfaces/Serve';
import { METHODS } from '../src/interfaces/Serve';
import { DaemonError, connectDaemon } from '../src/serve/client';
import { describeProtocol } from '../src/serve/schema';
import { startServer, type RunningServer, type ServerOptions } from '../src/serve/server';

const TOKEN = 'b'.repeat(64);

const STATUS: Status = {
  version: '0.11.0',
  proto: 1,
  pid: 42,
  startedAt: '2026-10-31T22:00:00.000Z',
  project: 'Demo',
  auth: { state: 'unknown' },
  cache: { items: 0, syncedAt: null, fullSyncedAt: null, stale: false },
  sync: { running: false, nextAt: null, backoffUntil: null, lastError: null },
  clients: 0,
};

const servers: RunningServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

function serve(overrides: Partial<ServerOptions> = {}): RunningServer {
  const server = startServer({
    token: TOKEN,
    version: '0.11.0',
    status: () => STATUS,
    handlers: { 'status.get': () => STATUS, 'schema.get': () => describeProtocol() },
    ...overrides,
  });
  servers.push(server);
  return server;
}

/** A raw TCP client: what an unauthenticated or broken peer sends, and whether it got closed. */
async function rawClient(port: number) {
  let text = '';
  let markClosed = () => {};
  const closed = new Promise<void>(resolve => (markClosed = resolve));
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data(_s, chunk) {
        text += new TextDecoder().decode(chunk);
      },
      close() {
        markClosed();
      },
    },
  });
  return {
    send: (data: string | Uint8Array) => socket.write(data),
    closed,
    lines: () => text.split('\n').filter(Boolean).map(line => JSON.parse(line)),
  };
}

async function within<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  return Promise.race([promise, Bun.sleep(ms).then(() => Promise.reject(new Error(`timed out after ${ms} ms`)))]);
}

describe('hello', () => {
  it('answers with the protocol, version and status, then serves the handlers', async () => {
    const server = serve();
    const client = await connectDaemon({ port: server.port, token: TOKEN });
    expect(client.hello).toEqual({ proto: 1, version: '0.11.0', status: STATUS });
    expect(await client.call('status.get')).toEqual(STATUS);
    client.close();
  });

  it('refuses a wrong token and closes the connection', async () => {
    const server = serve();
    const err = await connectDaemon({ port: server.port, token: 'c'.repeat(64) }).catch(e => e);
    expect(err).toBeInstanceOf(DaemonError);
    expect((err as DaemonError).kind).toBe('unauthorized');
  });

  it('closes a connection whose first message is not hello', async () => {
    const server = serve();
    const peer = await rawClient(server.port);
    peer.send('{"id":1,"method":"status.get"}\n');
    await within(peer.closed);
    expect(peer.lines()).toEqual([{ id: 1, error: expect.objectContaining({ kind: 'unauthorized' }) }]);
  });

  it('closes a connection that sends something unreadable before hello', async () => {
    const server = serve();
    const peer = await rawClient(server.port);
    peer.send('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
    await within(peer.closed);
    expect(peer.lines()[0]).toEqual({ id: null, error: expect.objectContaining({ kind: 'invalid_request' }) });
  });

  it('closes a connection that floods before hello', async () => {
    const server = serve();
    const peer = await rawClient(server.port);
    peer.send(new Uint8Array(70 * 1024).fill(0x61));
    await within(peer.closed);
  });

  it('closes a connection that never says hello', async () => {
    const server = serve({ helloTimeoutMs: 50 });
    const peer = await rawClient(server.port);
    await within(peer.closed, 1000);
  });

  it('refuses another protocol version', async () => {
    const server = serve();
    const peer = await rawClient(server.port);
    peer.send(`{"id":1,"method":"hello","params":{"token":"${TOKEN}","proto":2}}\n`);
    await within(peer.closed);
    expect(peer.lines()[0].error.message).toContain('Protocol 2');
  });

  it('runs beforeHello first, so its effect shows in the hello status', async () => {
    let auth: Status['auth'] = { state: 'needs_login' };
    const server = serve({
      status: () => ({ ...STATUS, auth }),
      beforeHello: () => {
        auth = { state: 'unknown', source: 'keychain' };
      },
    });
    const client = await connectDaemon({ port: server.port, token: TOKEN });
    expect(client.hello.status.auth).toEqual({ state: 'unknown', source: 'keychain' });
    client.close();
  });
});

describe('after hello', () => {
  it('answers a method without a handler yet with invalid_request and keeps the connection', async () => {
    const server = serve();
    const client = await connectDaemon({ port: server.port, token: TOKEN });
    const err = await client.call('items.list', {}).catch(e => e);
    expect((err as DaemonError).kind).toBe('invalid_request');
    expect(await client.call('status.get')).toEqual(STATUS);
    client.close();
  });

  it('answers an unreadable line with id null and keeps the connection', async () => {
    const server = serve();
    const peer = await rawClient(server.port);
    peer.send(`{"id":1,"method":"hello","params":{"token":"${TOKEN}","proto":1}}\n{ nope\n{"id":2,"method":"status.get"}\n`);
    await within(
      (async () => {
        while (peer.lines().length < 3) await Bun.sleep(10);
      })(),
    );
    // Answers come in completion order; the id is what pairs them with requests.
    const byId = (id: number | null) => peer.lines().find(line => line.id === id);
    expect(byId(1).result.proto).toBe(1);
    expect(byId(null)).toEqual({ id: null, error: expect.objectContaining({ kind: 'invalid_request' }) });
    expect(byId(2)).toEqual({ id: 2, result: STATUS });
  });

  it('turns a handler failure into its kind', async () => {
    const server = serve({
      handlers: {
        'status.get': () => {
          throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
        },
      },
    });
    const client = await connectDaemon({ port: server.port, token: TOKEN });
    const err = (await client.call('status.get').catch(e => e)) as DaemonError;
    expect(err.kind).toBe('needs_login');
    expect(err.error.hint).toContain('personalAccessToken');
    client.close();
  });

  it('delivers a multi-megabyte answer intact, past partial socket writes', async () => {
    const big = Array.from({ length: 20_000 }, (_, id) => ({ id, title: `Card ${id} — ação ✓`, state: 'In Progress' }));
    const server = serve({ handlers: { 'schema.get': () => big } });
    const client = await connectDaemon({ port: server.port, token: TOKEN });
    expect(JSON.stringify(big).length).toBeGreaterThan(1_000_000);
    expect(await client.call('schema.get')).toEqual(big);
    client.close();
  });

  it('runs a connection cleanup when the client goes, and counts only greeted clients', async () => {
    let cleaned = 0;
    const server = serve({
      handlers: {
        'status.get': (_params, conn) => {
          conn.onClose(() => cleaned++);
          return STATUS;
        },
      },
    });
    const idle = await rawClient(server.port);
    const client = await connectDaemon({ port: server.port, token: TOKEN });
    await client.call('status.get');
    expect(server.clients()).toBe(1);

    client.close();
    await within(client.closed);
    await within(
      (async () => {
        while (cleaned === 0) await Bun.sleep(10);
      })(),
    );
    expect(cleaned).toBe(1);
    expect(server.clients()).toBe(0);
    idle.send('');
  });
});

describe('schema.get', () => {
  it('describes every method of the contract', async () => {
    const server = serve();
    const client = await connectDaemon({ port: server.port, token: TOKEN });
    const schema = (await client.call('schema.get')) as ReturnType<typeof describeProtocol>;
    expect(schema.methods.map(m => m.name)).toEqual([...METHODS]);
    for (const method of schema.methods) expect(method.summary.length).toBeGreaterThan(0);
    client.close();
  });
});
