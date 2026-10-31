# azdev serve

A local daemon that keeps a cache of your Azure DevOps cards and answers clients over a socket. It exists so a long-lived client (a panel in a terminal multiplexer, an editor extension) can show cards without calling Azure DevOps on every redraw. This page is for whoever writes such a client.

## Transport

Newline-delimited JSON over TCP on `127.0.0.1`, one message per line. No HTTP, no WebSocket.

- Lines are UTF-8. Split the byte stream on `0x0A` before decoding, so a multi-byte character cut between two reads stays whole.
- A request line may have up to 256 KB. Answers have no limit and can be large (a watched list).
- JSON escapes newlines inside strings, so the only `0x0A` in a message is its terminator.
- The port is chosen by the daemon and the token is generated at each start. Both are in `serve.json` (see Files).

## Messages

- Request: `{"id": 1, "method": "items.list", "params": {...}}`. `id` is a non-negative integer you pick; `params` may be omitted.
- Success: `{"id": 1, "result": ...}`.
- Failure: `{"id": 1, "error": {"kind", "message", "hint?", "details?"}}`. `id` is `null` when the request could not be read far enough to know it.
- Push: `{"sub": "w1", "result": ...}`, sent for a watch.
- Event: `{"event": "status", "data": ...}`, sent to every connection.

Answers can arrive in any order; match them by `id`.

## Hello

The first message on every connection must be `hello`, within 2 seconds and 64 KB:

```json
{"id": 1, "method": "hello", "params": {"token": "<from serve.json>", "proto": 1, "client": "my-panel"}}
```

The result is `{proto, version, status}`, where `status` is the same object `status.get` returns. Anything else first, a wrong token or another `proto` is answered with an error and the connection is closed. A second `hello` is refused. `proto` changes only for a change that breaks an existing client; a new method or a new optional field does not change it.

## Methods

`schema.get` answers this list as data.

- `status.get`: `Status`. Daemon version, pid, project, login (`auth.state`: `ok`, `needs_login`, `unknown`), cache (`items`, `syncedAt`, `fullSyncedAt`, `stale`), sync (`running`, `nextAt`, `backoffUntil`, `lastError`) and the number of clients.
- `meta.get`: `Meta`. Work item types with their states and `transitions` (reachable states by current state, `""` for the initial one), sprints with dates and timeframe, team members, tags, area paths and `me`.
- `items.list` with `{filter?, sort?, fields?, limit?, offset?, facets?}`: `ItemsResult` with `{items, total, facets?, seq, syncedAt, stale, source}`.
- `items.get` with `{id}`: `{card}`.
- `items.detail` with `{id, comments?, history?}`: `CardDetail` with the card, description, acceptance criteria, the latest `comments` (default 20, at most 200), children, links, image URLs, attachments and, with `history: true`, a timeline of field changes.
- `items.setState` with `{id, state, rev?, comment?}`: `{card}`.
- `items.watch` with the same params as `items.list`: `{sub, ...ItemsResult}`.
- `items.unwatch` with `{sub}`: `{ok: true}`.
- `sync.run` with `{full?}`: `{changed, removed, syncedAt}`.
- `schema.get`: the protocol as data.

### Queries

A filter combines keys with AND; the values of one key are OR'ed.

- `assignee`: `@me`, `none`, `any` or an account or name.
- `sprint`: `current`, `previous`, a number, a name or a full path.
- `state`, `category` (`Proposed`, `InProgress`, `Resolved`, `Completed`, `Removed`), `type`, `tag`, `area` (under this path).
- `open`: true for cards not in `Completed` or `Removed`. "Open" is decided by the state's category, never by its name, so custom states count.
- `parent`: ids of the parent card.
- `q`: title text (ignoring case and accents) or `#id`.
- `changedSince`: an ISO instant or `7d`, `2w`, `today`.

`sort` takes card fields, `-` for descending (default `["-changedAt"]`). `fields` limits each item to those card fields (`id` is always there). `limit` defaults to 200, at most 1000. `facets` (`state`, `category`, `type`, `assignee`, `sprint`, `tag`) counts over the whole match, before paging.

A card has: `id`, `rev`, `type`, `state`, `stateCategory`, `stateColor`, `title`, `assignedTo`, `sprint`, `area`, `tags`, `priority`, `effort`, `storyPoints`, `remainingWork`, `boardColumn`, `parent`, `children` (`total`, `done`), `commentCount`, `changedBy`, `changedAt`, `stateChangedAt`, `createdAt`, `url`. Optional ones are absent when the card has no value.

### Where an answer comes from

The cache keeps your open cards in any sprint, the current sprint for everyone, and the cards you watch with `workitem watch`, each with its parents and children. `source` says which:

- `cache`: answered from memory.
- `live`: the cache did not hold everything the filter could match, so Azure DevOps was asked.

A live query returns at most 1000 cards, the most recently changed, and cuts the rest without a warning. Narrow the filter when `total` is exactly 1000. Its cards stay in the cache as a temporary scope, so the same query is then answered from memory; the scope expires after 30 minutes without being asked or watched, and the cards only it held leave the cache. A free-text search with no other restriction is always live and keeps nothing. Do not count on a list staying the same after a change of state or after a while idle.

`stale` is true when the answer comes from a cache that the last sync of this run did not confirm, or whose last attempt failed. Show a small mark, not an error.

### Changing a state

`items.setState` validates `state` against `meta.types[type].transitions[card.state]`, not against the type's list of states: the process restricts moves (a Task in Removed cannot go to Done). The name is matched ignoring case and the type's own spelling is sent.

- A state outside the transitions answers `invalid_state` with `details: {current, validStates}` and writes nothing.
- The current state answers the card without writing.
- `rev` is the revision your client saw. If the card changed since, nothing is written and the answer is `conflict`; reload and let the person decide.
- On success the daemon puts the saved card in the cache at once, and watchers get the push before the next sync. A state that takes the card out of a watched filter (Done leaves "mine, open") removes it from that list.

## Watching

`items.watch` answers like `items.list` plus `sub`. After each sync, and after each `items.setState`, the daemon recomputes every watch and pushes `{sub, result}` only when the cards or counts changed. A sync that changes nothing you watch sends nothing; `seq`, `syncedAt` and `stale` alone do not make a push. `items.unwatch` ends one; closing the connection ends all of that connection's watches. A watch keeps its live scope from expiring.

Watching is also what keeps the cache fresh: while at least one watch exists the daemon reads changes every 60 seconds and does a full read every 30 minutes. With no watch, nothing is synced on a timer; a data request finding the last sync older than 30 seconds refreshes behind its answer.

## Events

`status` is sent to every connection when the login, the `stale` flag or the last error changes. `data` is a `Status`.

## Errors

- `unauthorized`: bad token on hello.
- `needs_login`: no credential, or Azure DevOps refused it. `hint` says how to store one; the daemon re-reads the credential once and retries on a 401, and a running daemon picks up a token stored later.
- `config_missing`, `config_invalid`: no config file or an unusable one.
- `forbidden`, `not_found`: Azure DevOps said so.
- `invalid_request`: bad params or an unknown method; the message names what is wrong.
- `invalid_state`: a move the type does not allow, with `details`.
- `conflict`: the card changed since `rev`.
- `rate_limited`, `upstream`, `offline`: Azure DevOps is limiting, failing or unreachable. The cache keeps answering with `stale: true`; syncs wait 30 seconds, doubling up to 10 minutes, or what `Retry-After` asks. `status.sync.backoffUntil` shows the wait.
- `internal`: anything else.

A client that cannot reach the daemon at all should treat it as `offline`.

## Lifecycle

- `azdev serve start` starts the daemon in the background and returns when it answers hello, without waiting for a sync. One running with the same version is left alone; another version is replaced.
- `azdev serve stop` ends it. `azdev serve status` tells whether one answers.
- `azdev serve` with no action runs it in the foreground.
- `--port` fixes the port (default: any free one). `--idleExit` ends the daemon after that long with no client and no request: `30m`, `2h` (default), `0` for never.
- The daemon ends by itself when the compiled binary on disk is replaced, so installing a new build does not leave an old daemon around.
- A second daemon exits with code `75`: a lock held through the kernel allows one per user, and it is freed even if the first is killed.
- A client that finds no `serve.json`, or fails to connect or say hello, can run `azdev serve start --json` and try again.

## Files

- `serve.json` next to `config.json` (mode `0600`): `port`, `token`, `pid`, `version`, `proto`, `startedAt`. Written atomically once the daemon listens and removed on exit.
- `serve.lock` next to it.
- `snapshot-<hash>.json` in the cache directory (`AZDEV_CACHE_DIR`, else `$XDG_CACHE_HOME/azdev`, else `~/.cache/azdev`), mode `0600`. Card fields and metadata only: no description, comment or credential. It lets the first answer after a restart come without the network; it is ignored for another organization, project or schema.
- `serve.log` in the cache directory.

## Security

The socket listens on `127.0.0.1` only, and the first message must carry the token from `serve.json`, a file only your user can read. Anything that can read your files can talk to the daemon, as it could read the keychain entry; there is no other protection against a local process running as you. A client that has not said hello is dropped after 2 seconds, and one that stops reading is dropped when 16 MB are waiting. The credential never leaves the daemon: it is not in `serve.json`, the status or the log.

## Example

```
> {"id":1,"method":"hello","params":{"token":"…","proto":1,"client":"my-panel"}}
< {"id":1,"result":{"proto":1,"version":"0.11.0","status":{"auth":{"state":"ok","source":"keychain"},"cache":{"items":1782,"stale":false}}}}
> {"id":2,"method":"items.watch","params":{"filter":{"assignee":["@me"],"open":true},"fields":["title","state","stateCategory"],"facets":["state"],"limit":50}}
< {"id":2,"result":{"sub":"w1","items":[{"id":16053,"title":"…","state":"In Progress","stateCategory":"InProgress"}],"total":116,"facets":{"state":{"To Do":66,"In Progress":7}},"seq":4,"syncedAt":"2026-10-31T23:06:13.724Z","stale":false,"source":"cache"}}
> {"id":3,"method":"items.setState","params":{"id":16053,"state":"Done","rev":12}}
< {"id":3,"result":{"card":{"id":16053,"rev":13,"state":"Done"}}}
< {"sub":"w1","result":{"items":[],"total":115,"facets":{"state":{"To Do":66,"In Progress":6}},"seq":5,"syncedAt":"…","stale":false,"source":"cache"}}
< {"event":"status","data":{"auth":{"state":"ok"},"cache":{"stale":true}}}
```

## A client in QuickJS

The Herdr mods run in QuickJS, whose `net` module has `connect`, `read` (at most 64 KB per call) and `write`. This reads `serve.json`, says hello and calls methods; it splits on `0x0A` before decoding.

```js
import net from "net";
import { Buffer } from "buffer";
import { readTextFile } from "fs";

async function connect(home) {
  const info = JSON.parse(await readTextFile(`${home}/.config/azdev/serve.json`));
  const socket = await net.connect("127.0.0.1", info.port);
  const pending = new Map();
  let nextId = 1;
  let buffer = new Uint8Array(0);

  function dispatch(message) {
    if (message.sub || message.event) return; // pushes and events go to the screen
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(message.error);
    else waiter.resolve(message.result);
  }

  (async () => {
    for (;;) {
      const chunk = await socket.read(65536);
      if (chunk === null) break;
      const joined = new Uint8Array(buffer.length + chunk.length);
      joined.set(buffer);
      joined.set(chunk, buffer.length);
      let start = 0;
      for (let at = joined.indexOf(10, start); at !== -1; at = joined.indexOf(10, start)) {
        const line = Buffer.from(joined.subarray(start, at)).toString("utf8");
        if (line.trim()) dispatch(JSON.parse(line));
        start = at + 1;
      }
      buffer = joined.slice(start);
    }
  })();

  function call(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  await call("hello", { token: info.token, proto: 1, client: "my-panel" });
  return { call, close: () => socket.close() };
}
```
