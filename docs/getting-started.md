# Getting Started with azdev

`azdev` is a CLI tool for managing Azure DevOps work items, sprints, boards, and projects directly from the terminal.

## Prerequisites

- Access to an Azure DevOps organization
- A Personal Access Token (PAT) or another supported auth method (see [configuration.md](./configuration.md))

## Installation

### Option 1: Installer script (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/renatoadorno/azdev/main/install.sh | bash
```

Detects your platform (macOS arm64 or Linux x86-64), downloads the binary from the latest GitHub Release, verifies the SHA256 checksum, and installs to `~/.local/bin/azdev`.

To install a specific version:

```bash
AZDEV_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/renatoadorno/azdev/main/install.sh | bash
```

### Option 2: Manual download

Download the binary for your platform from the [Releases page](https://github.com/renatoadorno/azdev/releases):

| Binary | Platform |
|---|---|
| `azdev-darwin-arm64` | macOS Apple Silicon |
| `azdev-linux-x64` | Linux x86-64 |

Then install manually:

```bash
chmod +x azdev-darwin-arm64
mv azdev-darwin-arm64 ~/.local/bin/azdev
```

### Add to PATH

If `~/.local/bin` is not already in your PATH, add this to `~/.zshrc` or `~/.bashrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Verify the installation:

```bash
azdev --help
```

### Development setup (contributors only)

If you're contributing to azdev, build the binary locally with [Bun](https://bun.sh) >= 1.2:

```bash
bun install
bun run build.js
bash scripts/install-dev.sh
```

## Initial Configuration

azdev reads configuration from `~/.config/azdev/config.json`. Set it up with:

```bash
# Required: Azure DevOps organization URL
azdev config set orgUrl https://dev.azure.com/myorg

# Required: default project
azdev config set project MyProject

# For PAT authentication (default)
azdev config set personalAccessToken <your-token>
```

Confirm the config is correct:

```bash
azdev config show
```

For other authentication methods (Entra ID, NTLM, Basic), see [configuration.md](./configuration.md).

## First Commands

Once configured, try:

```bash
# Work items assigned to you
azdev workitem mine

# Current sprint
azdev sprint current

# List projects in the organization
azdev project list

# List all sprints
azdev sprint list
```

## Output Formats

All commands default to **toon-format** — a compact, token-efficient encoding suitable for piping to AI tools. You can switch to standard formats with flags:

```bash
# JSON output
azdev workitem mine --json

# Markdown table
azdev sprint list --markdown

# Override the default project for a single command
azdev workitem mine --project OtherProject
```

For a full list of commands and flags, see [commands.md](./commands.md).
