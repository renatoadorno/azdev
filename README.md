# azdev — Azure DevOps CLI

Manage Azure DevOps work items, sprints, boards, and projects from the terminal.

Supports PAT, Entra ID (Azure AD), NTLM, and Basic authentication. Output in toon (token-efficient default), JSON, or Markdown.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/renatoadorno/azdev/main/install.sh | bash
```

Downloads the latest release for your platform (Darwin arm64 or Linux x86-64), verifies the SHA256 checksum, and installs to `~/.local/bin/azdev`.

To install a specific version (the variable goes to `bash`, which runs the script):

```bash
curl -fsSL https://raw.githubusercontent.com/renatoadorno/azdev/main/install.sh | AZDEV_VERSION=v0.6.0 bash
```

Add `~/.local/bin` to your PATH if not already present:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Claude Code plugin

The repository is also a Claude Code marketplace with one plugin, `azdev`, that teaches the agent the CLI:

- **`azdev-cli`** — which command answers which question in one call, how to write descriptions and comments, how to create and audit a story's cards.
- **`conventions`** — reads, or creates by inspecting the board and asking you, a personal `conventions.md` with your team's rules (types without `Removed`, backlog sprint, title markers, who reviews and publishes), a `flows.json` for `azdev flow`, and `templates/` with the model of each card type's description. All stay next to `config.json`, outside any repository.
- **`setup`** (`/azdev:setup [orgUrl] [project]`) — installs the binary matching the plugin version, configures org and project, and walks you through storing the token in the keychain without pasting it in the chat.

```text
/plugin marketplace add renatoadorno/azdev
/plugin install azdev@azdev
/azdev:setup
```

The plugin version follows the CLI version. Only `plugin/` is installed — the CLI source stays out.

## Quick Start

```bash
# 1. Set your org URL
azdev config set orgUrl https://dev.azure.com/myorg

# 2. Set default project
azdev config set project MyProject

# 3. Set your PAT (stored in the OS keychain, never on disk)
azdev config set personalAccessToken <your-pat>

# 4. Start using it
azdev workitem mine
```

## Output Formats

All commands support three output formats:

| Flag | Format | Use case |
|---|---|---|
| *(default)* | toon — compact, token-efficient | AI consumers, terminal scanning |
| `--json` | JSON | scripting, jq pipelines |
| `--markdown` | Markdown table / key:value | reports, copy-paste |

Override the default project for any command with `--project <name>`.

## Commands

| Group | Subcommands | Description |
|---|---|---|
| `workitem` | 21 | Free `query` (filters, `--where`, WIQL, counts, groups), search, create (with parent/tags/sprint), update, comment, link; one-call `view`, comments, attachments, history timeline, story `progress`, description templates; `inbox` of what reached you since the last check |
| `sprint` | 7 | List sprints, current sprint, hydrated items, per-person summary by story, `progress` (pace, burn-up), `carryover` between sprints, capacity |
| `board` | 5 | List boards, columns, cards; move cards between columns; team members |
| `project` | 10 | Manage projects, areas, iterations, processes, work item types |
| `metadata` | 3 | Work item types (with states), fields and tags of the current project |
| `flow` | 3 | Story cycles from `flows.json`: create a story's standard cards, audit a story or a sprint |
| `stats` | 3 | Throughput per sprint or week, lead and cycle time, aging of open items |
| `config` | 5 | Show, get, set and unset CLI configuration; locate config, flows and conventions files |

Full command reference: [docs/commands.md](./docs/commands.md)

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error — API failure, invalid ID or flag value |
| `2` | Config file missing or incomplete (`orgUrl`/`project`), or `flows.json` missing/invalid for `flow` |

## Documentation

- [Getting Started](./docs/getting-started.md) — installation, initial setup, first commands
- [Configuration](./docs/configuration.md) — all config keys, auth types (PAT, Entra ID, NTLM, Basic), on-premises setup
- [Command Reference](./docs/commands.md) — all subcommands with arguments, options, and examples
- [Changelog](./CHANGELOG.md) — notable changes in each release

## Development

Requires [Bun](https://bun.sh) >= 1.2.

```bash
bun install
bun run dev:cli -- --help     # Run CLI without building
bun run build.js              # Compile binaries to dist/
bash scripts/install-dev.sh  # Install local build to ~/.local/bin
bunx tsc --noEmit             # Type-check
```

See [CLAUDE.md](./CLAUDE.md) for architecture and full developer documentation.

## License

[MIT](./LICENSE) © Renato Adorno
