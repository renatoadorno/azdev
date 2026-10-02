# Configuration

azdev stores its non-secret configuration in `~/.config/azdev/config.json` (mode `0600`) and its credentials in the operating system's credential store — Keychain on macOS, libsecret on Linux, Credential Manager on Windows. Tokens and passwords are never written to disk in plain text.

```bash
azdev config set <key> <value>
azdev config get <key>
azdev config show
azdev config unset <key>
```

## Config Keys

| Key | Required | Description |
|---|---|---|
| `orgUrl` | Yes | Organization URL, e.g. `https://dev.azure.com/myorg` |
| `project` | Yes | Default project name |
| `personalAccessToken` | PAT auth | Personal Access Token — stored in the OS keychain, not in the file |
| `authType` | No | Auth method: `pat` (default), `entra`, `ntlm`, `basic` |
| `isOnPremises` | No | Set to `true` for TFS / Azure DevOps Server |
| `collection` | On-prem only | Collection name (e.g. `DefaultCollection`) |
| `apiVersion` | On-prem only | API version header (e.g. `5.0`) |
| `username` | NTLM / Basic | Username |
| `password` | NTLM / Basic | Password — stored in the OS keychain, not in the file |
| `domain` | NTLM only | Windows domain |
| `richTextFormat` | No | Default format of descriptions and comments written by `create`/`update`/`comment`/`bulk-create` when `--format` is absent: `html` (API default) or `markdown`. Any other value exits `2` |

Story flows for `azdev flow` live in a separate `flows.json` next to `config.json` — see [flow](./commands.md#flow).

## Credential Storage

`personalAccessToken` and `password` are routed to the OS keychain by `azdev config set` and never reach `config.json`. They are looked up under the service `com.azdev.cli`, scoped by organization (`pat:<orgUrl>`, `password:<orgUrl>`), so several organizations can coexist.

Resolution order at runtime:

1. Environment variable — `AZDEV_PAT` for the token, `AZDEV_PASSWORD` for NTLM/Basic
2. OS keychain
3. Otherwise the command fails with exit code 2

There is no fallback to the config file. On a machine without a keychain service (a container, or Linux without libsecret), use the environment variable.

```bash
azdev config set personalAccessToken <your-token>   # stores in the keychain
azdev config show                                   # prints credentialSource, never the value
azdev config unset personalAccessToken              # removes it from the keychain

AZDEV_PAT=<token> azdev workitem mine               # one-off override, e.g. in CI
```

### Migrating an existing config

A `config.json` still holding a `personalAccessToken` or `password` in plain text is migrated automatically on the next command: the value moves to the keychain, the key is stripped from the file, and the file is tightened to `0600`. The migration is announced on stderr and happens only once. If the keychain write fails, the file is left untouched and the command exits 2 — the credential is never destroyed by a failed migration.

Because the token was readable on disk before the migration, rotate it afterwards.

### Environment Variables

| Variable | Purpose |
|---|---|
| `AZDEV_PAT` | Personal Access Token; takes precedence over the keychain |
| `AZDEV_PASSWORD` | NTLM / Basic password; takes precedence over the keychain |
| `AZDEV_CONFIG_PATH` | Full path to an alternative config file |
| `XDG_CONFIG_HOME` | Base config directory, used when `AZDEV_CONFIG_PATH` is unset |

## Authentication Types

### PAT (Personal Access Token) — Default

The simplest method. [Create a PAT](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) in Azure DevOps with the required scopes (Work Items read/write, Project read).

```bash
azdev config set authType pat
azdev config set personalAccessToken <your-token>
```

### Entra ID (Azure AD / OIDC)

Uses `DefaultAzureCredential` from `@azure/identity`. Supports Azure CLI login, managed identity, environment variables, and more. Cloud-only (not supported on-premises).

```bash
azdev config set authType entra
```

No token needed — credentials are resolved automatically from the environment. To use the Azure CLI credential:

```bash
az login
```

### NTLM (Windows / On-Premises)

For TFS or Azure DevOps Server with Windows authentication.

```bash
azdev config set authType ntlm
azdev config set username DOMAIN\\myuser
azdev config set password mypassword
azdev config set domain MYDOMAIN      # optional if included in username
azdev config set isOnPremises true
azdev config set orgUrl http://tfs.mycompany.com
azdev config set collection DefaultCollection
```

### Basic

HTTP Basic authentication. Typically used on-premises or with proxies.

```bash
azdev config set authType basic
azdev config set username myuser
azdev config set password mypassword
```

## On-Premises / TFS Setup

For TFS or Azure DevOps Server, set these additional keys:

```bash
azdev config set isOnPremises true
azdev config set orgUrl http://tfs.mycompany.com
azdev config set collection DefaultCollection   # your collection name
azdev config set apiVersion 5.0                 # match your TFS version
```

Common API versions by TFS release:

| TFS / ADO Server version | API version |
|---|---|
| TFS 2017 | `3.0` |
| TFS 2018 | `4.0` |
| Azure DevOps Server 2019 | `5.0` |
| Azure DevOps Server 2020 | `6.0` |
| Azure DevOps Server 2022 | `7.0` |

## Per-Command Project Override

Any command accepts `--project <name>` to target a different project without changing the config:

```bash
azdev workitem mine --project AnotherProject
azdev sprint current --project AnotherProject
```

## Example Config File

```json
{
  "orgUrl": "https://dev.azure.com/myorg",
  "project": "MyProject",
  "authType": "pat"
}
```

The file is plain JSON and can be edited directly — but credentials do not belong in it. A token added by hand is migrated to the keychain on the next command, and is redacted from `azdev config show` in the meantime.
