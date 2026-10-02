---
name: setup
description: "Install, update or configure the azdev CLI (binary, org, project, token). Use when the user asks to install or set up azdev; when an azdev command is not found or unknown, fails with 401, or exits 2 over a missing config or credential (a missing or invalid flows.json belongs to the conventions skill); when the installed version differs from this plugin's."
argument-hint: "[orgUrl] [project]"
---

# Set up the azdev CLI

Install the `azdev` binary that matches this plugin, then configure the organization, project and credential. Run each step when its check fails or the user's arguments ask for a change, and confirm with the user before installing or overwriting anything.

## 1. Binary

1. Read the plugin version: `grep '"version"' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"`.
2. Check the installed one: `command -v azdev && azdev --version`.
3. When it is missing or differs from the plugin version, ask the user, then install that version from its GitHub release (the script verifies the SHA256 and installs to `~/.local/bin/azdev`):

   ```bash
   curl -fsSL "https://raw.githubusercontent.com/renatoadorno/azdev/v<version>/install.sh" | AZDEV_VERSION="v<version>" bash
   ```

   If curl reports 404 (the pipeline still exits `0`), that tag has no release yet. Tell the user, and offer the latest release — the same command against `main` without `AZDEV_VERSION` — warning that it may be older than this plugin and lack commands its skills use (`config paths`, `flow`, `workitem view`).
4. Done when `azdev --version` prints the plugin version (or the version the user accepted). Two known failures:
   - **Exit 137 with no output on macOS** — the ad-hoc signature is invalid and the kernel kills the process. Fix with `codesign --force --sign - ~/.local/bin/azdev` and run it again.
   - **`command not found` right after installing** — `~/.local/bin` is not on `PATH`. Show the line to add to the shell profile, and edit the profile only if the user asks.

Supported platforms: macOS arm64 and Linux x64. On anything else, build for this machine from a clone of the repository at tag `v<version>`: `bun install && bun build --compile src/cli/index.ts --outfile ~/.local/bin/azdev` — `bun run build.js` only produces the two release binaries.

## 2. Organization and project

1. Run `azdev config show`. Exit `2` means the file is missing or not valid JSON; an output without `orgUrl` or `project` means it is incomplete (exit `0`). Either case runs this step.
2. Use the arguments when given (`/azdev:setup https://dev.azure.com/acme MyProject`) — also when a config exists and they name another org or project; confirm before overwriting. Otherwise ask for the organization URL and the default project.
3. Set them:

   ```bash
   azdev config set orgUrl https://dev.azure.com/<org>
   azdev config set project "<project>"
   ```

   The token is stored per org URL, so after changing `orgUrl` run step 3 again.
4. Offer `azdev config set richTextFormat markdown` when the team writes descriptions in Markdown.
5. For Azure DevOps Server (an org URL outside `dev.azure.com` and `visualstudio.com`), also set `isOnPremises true`, `collection` and `apiVersion` — see `docs/configuration.md` in the repository.

## 3. Credential

The token goes to the OS keychain and stays out of the conversation: keep it out of chat messages and out of every command run here, since command lines and their output land in the transcript.

1. Ask the user to run this in their own terminal, outside Claude Code (the `!` prefix would also land in the transcript). `read -s` keeps the token off the screen and out of the shell history:

   ```bash
   printf 'PAT: '; read -rs AZDEV_TOKEN; echo; azdev config set personalAccessToken "$AZDEV_TOKEN"; unset AZDEV_TOKEN
   ```

   Scopes: *Work Items (Read & Write)* and *Project and Team (Read)* — `board members` and the `project` commands need the second.
2. Alternatives: `AZDEV_PAT` in the environment (CI, containers, Linux without a secret service), or `azdev config set authType entra` to use the Azure CLI or managed identity login (cloud only).
3. When the user confirms, run `azdev config show` — `credentialSource` must be `keychain` or `env` (with `authType entra` the field is absent; go to the test call) — and then `azdev workitem mine --top 1`. Done when that call lists items or an empty list. A 401 means a wrong or expired token, or a missing scope.

## 4. Team conventions

Hand over to the **conventions** skill of this plugin: it creates `conventions.md` and, when the user wants story flows, `flows.json`, both next to `config.json` (`azdev config paths`).

## Report

End with one line per step: the installed version, the org and project, the credential source, and which convention files exist.
