# azdev — Azure DevOps CLI

Manage Azure DevOps work items, sprints, boards, and projects from the terminal.

Supports PAT, Entra ID (Azure AD), NTLM, and Basic authentication. Output in toon (token-efficient default), JSON, or Markdown.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/renatoadorno/azdev/main/install.sh | bash
```

Downloads the latest release for your platform (Darwin arm64 or Linux x86-64), verifies the SHA256 checksum, and installs to `~/.local/bin/azdev`.

To install a specific version:

```bash
AZDEV_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/renatoadorno/azdev/main/install.sh | bash
```

Add `~/.local/bin` to your PATH if not already present:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Quick Start

```bash
# 1. Set your org URL
azdev config set orgUrl https://dev.azure.com/myorg

# 2. Set default project
azdev config set project MyProject

# 3. Set your PAT
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
| `workitem` | 13 | List, search, create, update, comment, link work items |
| `sprint` | 4 | List sprints, get current sprint, items and capacity |
| `board` | 5 | List boards, columns, items; move cards; team members |
| `project` | 10 | Manage projects, areas, iterations, processes, work item types |
| `config` | 3 | Show, get, and set CLI configuration |

Full command reference: [docs/commands.md](./docs/commands.md)

## Documentation

- [Getting Started](./docs/getting-started.md) — installation, initial setup, first commands
- [Configuration](./docs/configuration.md) — all config keys, auth types (PAT, Entra ID, NTLM, Basic), on-premises setup
- [Command Reference](./docs/commands.md) — all 32 subcommands with arguments, options, and examples

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
