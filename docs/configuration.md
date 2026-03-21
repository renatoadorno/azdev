# Configuration

azdev stores its configuration in `~/.config/azdev/config.json`. All values can be set with:

```bash
azdev config set <key> <value>
azdev config get <key>
azdev config show
```

## Config Keys

| Key | Required | Description |
|---|---|---|
| `orgUrl` | Yes | Organization URL, e.g. `https://dev.azure.com/myorg` |
| `project` | Yes | Default project name |
| `personalAccessToken` | PAT auth | Personal Access Token |
| `authType` | No | Auth method: `pat` (default), `entra`, `ntlm`, `basic` |
| `isOnPremises` | No | Set to `true` for TFS / Azure DevOps Server |
| `collection` | On-prem only | Collection name (e.g. `DefaultCollection`) |
| `apiVersion` | On-prem only | API version header (e.g. `5.0`) |
| `username` | NTLM / Basic | Username |
| `password` | NTLM / Basic | Password |
| `domain` | NTLM only | Windows domain |

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
  "personalAccessToken": "xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "authType": "pat"
}
```

The file is plain JSON and can be edited directly.
