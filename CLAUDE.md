# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
bun install

# Run in dev mode
bun run dev:cli    # CLI

# Build 2 standalone binaries
bun run build.js

# Install CLI binary to ~/.local/bin
bash install.sh          # install only (binary must exist)
bun run build:install    # build + install
bun run install:cli      # install only (via npm script)

# Tests and types
bun run test             # bun test — unit suite, mocks the keychain
bun run typecheck        # bunx tsc --noEmit
AZDEV_TEST_KEYCHAIN=1 bun test   # also exercises the real OS keychain
```

Tests live in `test/` (`bun test`). They cover the config/credential layer, the
pure rules (sprint resolution, rich text, WIQL filters, flow audit/plan, sprint
summary, history timeline, flows.json loading) and `WorkItemService` request
building against an in-memory fake of the SDK (`test/workItemService.test.ts`).
They never call Azure DevOps. Config tests isolate themselves with
`AZDEV_CONFIG_PATH` pointing at a tmpdir (flows.json follows it) and mock
`src/cli/secrets.ts`; `test/secrets.test.ts` spies on `Bun.secrets` directly.
New logic goes into a pure module first so it can be tested without the network.

## Architecture

This repo exposes Azure DevOps **task and project management** capabilities via a CLI:

- **CLI** (`dist/azdev-*`) — uses `citty`, outputs toon-format by default (token-efficient), with `--json` and `--markdown` flags

**Active modules:** WorkItems, BoardsSprints, Projects, Metadata, Flows, Stats.

### Layer structure

```
src/
  interfaces/       — TypeScript types shared across layers
    AzureDevOps.ts  — AzureDevOpsConfig and auth types
    Flows.ts        — flows.json schema (FlowsFile/FlowDefinition/FlowCard) and flow params
    Stats.ts        — stats params (StatsFilters, CarryoverRules from flows.json)
    *.ts            — Domain-specific param interfaces per command group
  services/         — Direct Azure DevOps API wrappers (use azure-devops-node-api)
    AzureDevOpsService.ts  — Base class: connection/auth, plus what every service shares:
                             resolveIteration (--sprint), currentUser/resolveAssignee (@me),
                             currentUserId (identity GUID a mention carries),
                             hydrate (batch getWorkItems), queryIds (WIQL → ids; timePrecision
                             compares dates to the instant), childrenOf (direct children by
                             parent), stateCategories/bucketFn (done/removed by state
                             category, so custom states count), project, webUrl,
                             resolveFieldNames (aliases; getFields only for unknown names)
    EntraAuthHandler.ts    — Singleton IRequestHandler using DefaultAzureCredential (Entra/OIDC)
    WorkItemService.ts     — CRUD + queries; buildCreateRequest (parent/tags/sprint in one
                             request, also used by --dryRun), markdown comments, state hints,
                             buildQuery/queryWorkItems (`workitem query`)
    WorkItemViewService.ts — view (one-call context) and attachments (list/download)
    InboxService.ts        — `workitem inbox` since an instant: my cards others changed and
                             cards others took from me (AssignedTo EVER @me), both decided by
                             each card's revisions walked back from System.Rev; watched cards
                             and their children others changed, and the watched cards
                             finished with all their children (`closed`, archived by the
                             CLI); comments mentioning me (@RecentMentions candidates,
                             comments paged); watch list rows for `workitem watch`
    FlowService.ts         — flow status/apply over FlowsFile
    StatsService.ts        — sprint progress/carryover, story progress, throughput,
                             cycle time, aging; past board states through WIQL ASOF
    *Service.ts     — Other domain services extending AzureDevOpsService
    Pure modules (no network, unit-tested):
    workItemUtils.ts — slimWorkItem, WIQL filters/escape, tags, patch ops, constants
    iterations.ts    — classification node flattening + matchIteration
    richText.ts      — HTML/Markdown field → text, attachment url parsing
    flowRules.ts     — flows.json validation, card matching, audit, apply plan
    sprintSummary.ts — delivery grouped by story
    history.ts       — revisions → field-change timeline
    inbox.ts         — inbox window (--since / last check / 1d), its WIQL, changes by others
                       and removals from me read off revisions, mention matching (HTML
                       data-vss-mention or Markdown @<id>), new vs changed
    watch.ts         — watch list per project (add / remove / archive) and watch.json
                       parsing that throws on a malformed file instead of reading it empty
    descriptionTemplates.ts — template fill + checkDescription (a template is a model:
                              missing, untouched or leftover <…> prompts are refused)
    fieldNames.ts    — field aliases and name → reference name resolution
    queryBuilder.ts  — query flags → WIQL, relative dates (7d/2w), [short] names in --where
    stats.ts         — state buckets from state categories, totals, working days, pace,
                       percentiles, weeks, aging, carry-over
  cli/
    index.ts        — CLI entry point (citty), registers command groups
    command.ts      — globalOptions + runService()/runCommand(): the body every
                      subcommand shares (load config, apply --project, format, handle errors)
    config.ts       — configPath() / loadCliConfig() / writeCliConfig() / unsetCliConfig()
                      Non-secret config → ~/.config/azdev/config.json (mode 0600)
    secrets.ts      — Bun.secrets wrapper: resolveSecret/storeSecret/deleteSecret/redactSecrets
                      Credentials live in the OS keychain (service com.azdev.cli)
    flows.ts        — flowsPath() (next to config.json) / loadFlows() (exit 2 when missing/invalid)
    templates.ts    — templates/ next to config.json: loadTemplates(), chooseTemplate() (type
                      default, --template, --noTemplate), readCardDescriptions() for flow apply
    inboxState.ts   — inbox.json next to config.json: last check per project (read/save)
    watchState.ts   — watch.json next to config.json: readWatch / updateWatch (atomic rename)
    errors.ts       — exitWithError(): 1-line stderr message (statusCode prefix, credential hint on 401) + exit
    parsers.ts      — flag validation before any API call (parseId, parseCount, parseCsv,
                      parseRichTextFormat, textOrFile for --*File flags); failUsage() exits 1
    warnings.ts     — silences DEP0169 only: azure-devops-node-api still calls the
                      legacy url.parse() (VsoClient.js/WebApi.js, still there in v17)
    statsArgs.ts    — filter flags every stats command shares (--mine/--assignedTo/--type/--product)
    commands/       — One file per command group; each calls services directly
      workitem.ts   — 22 subcommands
      sprint.ts     — 7 subcommands
      board.ts      — 5 subcommands
      project.ts    — 10 subcommands
      metadata.ts   — 3 subcommands (types, fields, tags)
      flow.ts       — list / status / apply
      stats.ts      — throughput / cycle-time / aging
      config.ts     — show / set / get / unset / paths
    formatters/
      index.ts      — format(data, flags) selector
      toon.ts       — encode() from @toon-format/toon (default)
      json.ts       — JSON.stringify
      markdown.ts   — Markdown table for arrays, key:value for objects
test/               — bun test suite (config/credentials, pure rules, service request building)
  helpers.ts        — env guard, tmpdir config, process.exit/console.error capture
```

Writes (`create`, `update`, `set-state`, `assign`, `link`, `bulk-create`) print
`svc.summarize(workItem)` — compact fields plus browser url — unless `--raw`.

`loadCliConfig()` is **async** (the keychain API is): every `getService()` in
`cli/commands/*` awaits it.

### Binaries

| Binary | Platform | Entry point |
|---|---|---|
| `dist/azdev-darwin-arm64` | darwin-arm64 | `src/cli/index.ts` |
| `dist/azdev-linux-x64` | linux-x64 | `src/cli/index.ts` |

Built with `--compile --minify --bytecode`, and `--define BUILD_VERSION` carrying
`package.json`'s version — bump it there and the binaries follow.

### Data flow

1. CLI command calls `loadCliConfig()` → gets `AzureDevOpsConfig` from `~/.config/azdev/config.json`
2. Command instantiates the relevant `*Service` with the config
3. Service calls `azure-devops-node-api`
4. Response is formatted via `format(data, flags)` → toon (default), JSON, or Markdown

### Claude Code plugin

The repo is also a marketplace: `.claude-plugin/marketplace.json` points at
`plugin/` (`source: "./plugin"`), so installing copies only `plugin/` — never
`src/`, `node_modules/` or `dist/`.

```
plugin/
  .claude-plugin/plugin.json
  skills/azdev-cli/          — usage router + references/commands.md (every flag)
  skills/conventions/        — reads/creates the per-user conventions.md and flows.json
    assets/                  — conventions.template.md, flows.example.json
  skills/setup/              — /azdev:setup: binary matching the plugin version, org, project, token
```

`test/plugin.test.ts` enforces what `claude plugin validate` does not check:
- `package.json`, `plugin.json` and the marketplace entry carry the same version — bump all three together;
- strict YAML frontmatter in every `SKILL.md` (an unquoted `: ` silently drops name and description);
- every `azdev <group> <sub>` mentioned in a skill exists, and the subcommand count in `azdev-cli` is right;
- every subcommand and flag of the CLI appears in `skills/azdev-cli/references/commands.md` — a new flag fails the suite until it is documented there;
- `flows.example.json` passes `validateFlows`.

The plugin is public: skills stay generic. Team-specific rules (state quirks, backlog
sprint, people) belong in the user's `conventions.md`, next to `config.json`.

Validate manifests with `claude plugin validate .` (marketplace) and
`claude plugin validate ./plugin`.

### Adding a new command

1. Add param interface to the appropriate `src/interfaces/*.ts` file
2. Add method to the relevant `*Service.ts` in `src/services/` (extending `AzureDevOpsService`)
3. Add the subcommand to the relevant `src/cli/commands/*.ts`:

```ts
const mine = defineCommand({
  meta: { name: 'mine', description: '...' },
  args: { ...globalOptions, top: { type: 'string', description: '...' } },
  async run({ args }) {
    await runService(WorkItemService, args, (svc) => svc.getMyWorkItems({ top: args.top }));
  },
});
```

`runService` owns the shared body — config load, `--project` override, output
formatting and `exitWithError`. Do not re-implement it per subcommand. Argument
parsing that must run *before* the call (e.g. `parseId`) stays above it; a
non-default view goes in an `async` callback that returns the value to print.

4. Document the subcommand and each flag in `plugin/skills/azdev-cli/references/commands.md`
   (the plugin test fails otherwise), and in `docs/commands.md`.

### Exit codes

- `0` — success
- `1` — error (API failures via `exitWithError`, invalid IDs, invalid flag values)
- `2` — config file missing/invalid, incomplete, or no credential found (`loadCliConfig` / `config show`); flows.json missing/invalid (`loadFlows`)

## Configuration

Non-secret config lives in `~/.config/azdev/config.json` (mode `0600`); credentials
live in the OS keychain and never touch the file.

```json
{
  "orgUrl": "https://dev.azure.com/myorg",
  "project": "MyProject",
  "authType": "pat"
}
```

Set values with: `azdev config set orgUrl https://dev.azure.com/myorg`

| Key | Required | Description |
|---|---|---|
| `orgUrl` | Yes | Org URL, e.g. `https://dev.azure.com/myorg` |
| `project` | Yes | Default project name |
| `personalAccessToken` | For PAT | PAT token — **OS keychain**, not the file |
| `password` | NTLM / Basic | Password — **OS keychain**, not the file |
| `authType` | No | `pat` (default), `entra`, `ntlm`, `basic` |
| `isOnPremises` | No | `true` for TFS/Azure DevOps Server |
| `collection` | On-prem only | Collection name |
| `apiVersion` | On-prem only | API version header |
| `richTextFormat` | No | `html`/`markdown` default for `--format` on create/update/comment |

### Credentials

Resolution order: env var → OS keychain → exit 2. **There is no fallback to the file.**

| Variable | Purpose |
|---|---|
| `AZDEV_PAT` | PAT; wins over the keychain |
| `AZDEV_PASSWORD` | NTLM/Basic password; wins over the keychain |
| `AZDEV_CONFIG_PATH` | Override the full config file path (used by tests) |
| `XDG_CONFIG_HOME` | Config base dir when `AZDEV_CONFIG_PATH` is unset |

Keychain entries: service `com.azdev.cli`, name `pat:<orgUrl>` / `password:<orgUrl>`.
A legacy `config.json` holding a plain-text credential is migrated on the next
command — the key is only stripped from disk after the keychain write succeeds.
`config show` redacts credentials and reports `credentialSource`.

`entra` auth uses `DefaultAzureCredential` from `@azure/identity` (supports managed identity, Azure CLI, env vars, etc.), is cloud-only, and reads no credential from config.

## CLI Output Formats

- Default: toon-format (token-efficient, ~40% fewer tokens than JSON)
- `--json`: standard JSON
- `--markdown`: Markdown table (arrays) or key: value pairs (objects)
- `--project <name>`: override project from config on any command

## Dependencies

- `@toon-format/toon` — token-efficient encoding for AI consumers
- `citty` — CLI framework
- `azure-devops-node-api` — Azure DevOps REST API wrapper
- `@azure/identity` — Azure authentication (Entra/OIDC support)
