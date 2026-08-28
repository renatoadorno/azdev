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

Tests live in `test/` and cover the config/credential layer only (`bun test`). They
isolate themselves with `AZDEV_CONFIG_PATH` pointing at a tmpdir and mock
`src/cli/secrets.ts`; `test/secrets.test.ts` spies on `Bun.secrets` directly.
The rest of the codebase has no automated tests.

## Architecture

This repo exposes Azure DevOps **task and project management** capabilities via a CLI:

- **CLI** (`dist/azdev-*`) — uses `citty`, outputs toon-format by default (token-efficient), with `--json` and `--markdown` flags

**Active modules:** WorkItems, BoardsSprints, Projects, Metadata.

### Layer structure

```
src/
  interfaces/       — TypeScript types shared across layers
    AzureDevOps.ts  — AzureDevOpsConfig and auth types
    *.ts            — Domain-specific param interfaces per command group
  services/         — Direct Azure DevOps API wrappers (use azure-devops-node-api)
    AzureDevOpsService.ts  — Base class: creates azdev.WebApi connection, handles auth
    EntraAuthHandler.ts    — Singleton IRequestHandler using DefaultAzureCredential (Entra/OIDC)
    *Service.ts     — Domain services extending AzureDevOpsService
  cli/
    index.ts        — CLI entry point (citty), registers command groups
    command.ts      — globalOptions + runService()/runCommand(): the body every
                      subcommand shares (load config, apply --project, format, handle errors)
    config.ts       — configPath() / loadCliConfig() / writeCliConfig() / unsetCliConfig()
                      Non-secret config → ~/.config/azdev/config.json (mode 0600)
    secrets.ts      — Bun.secrets wrapper: resolveSecret/storeSecret/deleteSecret/redactSecrets
                      Credentials live in the OS keychain (service com.azdev.cli)
    errors.ts       — exitWithError(): 1-line stderr message (statusCode prefix, credential hint on 401) + exit
    parsers.ts      — parseId(): positive-integer validation for work item IDs
    warnings.ts     — silences DEP0169 only: azure-devops-node-api still calls the
                      legacy url.parse() (VsoClient.js/WebApi.js, still there in v17)
    commands/       — One file per command group; each calls services directly
      workitem.ts   — 14 subcommands
      sprint.ts     — 4 subcommands
      board.ts      — 5 subcommands
      project.ts    — 10 subcommands
      metadata.ts   — 2 subcommands (types, tags)
      config.ts     — show / set / get / unset
    formatters/
      index.ts      — format(data, flags) selector
      toon.ts       — encode() from @toon-format/toon (default)
      json.ts       — JSON.stringify
      markdown.ts   — Markdown table for arrays, key:value for objects
test/               — bun test suite for the config/credential layer
  helpers.ts        — env guard, tmpdir config, process.exit/console.error capture
```

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

### Exit codes

- `0` — success
- `1` — error (API failures via `exitWithError`, invalid IDs, invalid flag values)
- `2` — config file missing/invalid, incomplete, or no credential found (`loadCliConfig` / `config show`)

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
