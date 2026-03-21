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
```

There are no automated tests. TypeScript type checking is done implicitly by Bun at runtime; to check types without running, use `bunx tsc --noEmit`.

## Architecture

This repo exposes Azure DevOps **task and project management** capabilities via a CLI:

- **CLI** (`dist/azdev`) — uses `citty`, outputs toon-format by default (token-efficient), with `--json` and `--markdown` flags

**Active modules:** WorkItems, BoardsSprints, Projects.

### Layer structure

```
src/
  Interfaces/       — TypeScript types shared across layers
    AzureDevOps.ts  — AzureDevOpsConfig and auth types
    *.ts            — Domain-specific param interfaces per command group
  Services/         — Direct Azure DevOps API wrappers (use azure-devops-node-api)
    AzureDevOpsService.ts  — Base class: creates azdev.WebApi connection, handles auth
    EntraAuthHandler.ts    — Singleton IRequestHandler using DefaultAzureCredential (Entra/OIDC)
    *Service.ts     — Domain services extending AzureDevOpsService
  cli/
    index.ts        — CLI entry point (citty), registers command groups
    config.ts       — loadCliConfig() / writeCliConfig() → ~/.config/azdev/config.json
    commands/       — One file per command group; each calls Services directly
      workitem.ts   — 13 subcommands
      sprint.ts     — 4 subcommands
      board.ts      — 5 subcommands
      project.ts    — 10 subcommands
      config.ts     — show / set / get
    formatters/
      index.ts      — format(data, flags) selector
      toon.ts       — encode() from @toon-format/toon (default)
      json.ts       — JSON.stringify
      markdown.ts   — Markdown table for arrays, key:value for objects
```

### Binaries

| Binary | Platform | Entry point |
|---|---|---|
| `dist/azdev` | darwin-arm64 | `src/cli/index.ts` |
| `dist/azdev-linux` | linux-x64 | `src/cli/index.ts` |

### Data flow

1. CLI command calls `loadCliConfig()` → gets `AzureDevOpsConfig` from `~/.config/azdev/config.json`
2. Command instantiates the relevant `*Service` with the config
3. Service calls `azure-devops-node-api`
4. Response is formatted via `format(data, flags)` → toon (default), JSON, or Markdown

### Adding a new command

1. Add param interface to the appropriate `src/Interfaces/*.ts` file
2. Add method to the relevant `*Service.ts` (extending `AzureDevOpsService`)
3. Add subcommand to the relevant `src/cli/commands/*.ts`, calling the service directly

## Configuration

The CLI reads from `~/.config/azdev/config.json`:

```json
{
  "orgUrl": "https://dev.azure.com/myorg",
  "project": "MyProject",
  "personalAccessToken": "xxx",
  "authType": "pat"
}
```

Set values with: `azdev config set orgUrl https://dev.azure.com/myorg`

| Key | Required | Description |
|---|---|---|
| `orgUrl` | Yes | Org URL, e.g. `https://dev.azure.com/myorg` |
| `project` | Yes | Default project name |
| `personalAccessToken` | For PAT | PAT token |
| `authType` | No | `pat` (default), `entra`, `ntlm`, `basic` |
| `isOnPremises` | No | `true` for TFS/Azure DevOps Server |
| `collection` | On-prem only | Collection name |
| `apiVersion` | On-prem only | API version header |

`entra` auth uses `DefaultAzureCredential` from `@azure/identity` (supports managed identity, Azure CLI, env vars, etc.) and is cloud-only.

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
