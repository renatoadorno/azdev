# Command Reference

## Global Flags

These flags are available on every command:

| Flag | Description |
|---|---|
| `--json` | Output as JSON |
| `--markdown` | Output as Markdown table (arrays) or key: value pairs (objects) |
| `--project <name>` | Override the default project from config for this command only |

---

## workitem

Work item management.

### `workitem list`

List work items using a WIQL query.

```
azdev workitem list [--query <wiql>]
```

| Option | Type | Default | Description |
|---|---|---|---|
| `--query` | string | `SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.CreatedDate] DESC` | WIQL query string |

**Examples:**

```bash
# Default query (all work items in the project)
azdev workitem list

# Custom WIQL query
azdev workitem list --query "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active'"
```

---

### `workitem get`

Get a single work item by ID.

```
azdev workitem get <id>
```

| Argument | Type | Description |
|---|---|---|
| `id` | number | Work item ID |

**Examples:**

```bash
azdev workitem get 42
azdev workitem get 42 --json
```

---

### `workitem history`

Get the revision history of a work item.

```
azdev workitem history <id>
```

| Argument | Type | Description |
|---|---|---|
| `id` | number | Work item ID |

**Examples:**

```bash
azdev workitem history 42
```

---

### `workitem search`

Search work items by text (searches title and description).

```
azdev workitem search <query> [--top <n>]
```

| Argument/Option | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Search text |
| `--top` | number | — | Max results to return |

**Examples:**

```bash
azdev workitem search "login bug"
azdev workitem search "payment" --top 5 --json
```

---

### `workitem recent`

Get recently updated work items.

```
azdev workitem recent [--top <n>] [--skip <n>]
```

| Option | Type | Default | Description |
|---|---|---|---|
| `--top` | number | `10` | Max results |
| `--skip` | number | `0` | Skip N results (for pagination) |

**Examples:**

```bash
azdev workitem recent
azdev workitem recent --top 20 --skip 10
```

---

### `workitem mine`

Get work items assigned to the current user.

```
azdev workitem mine [--state <state>] [--path <iterationPath>] [--top <n>]
```

| Option | Type | Default | Description |
|---|---|---|---|
| `--state` | string | — | Filter by state (e.g., `Active`, `Resolved`) |
| `--path` | string | — | Filter by iteration path |
| `--top` | number | `100` | Max results |

**Examples:**

```bash
azdev workitem mine
azdev workitem mine --state Active
azdev workitem mine --path "MyProject\\Sprint 5"
```

---

### `workitem create`

Create a new work item.

```
azdev workitem create --type <type> --title <title> [options]
```

| Option | Type | Required | Description |
|---|---|---|---|
| `--type` | string | Yes | Work item type (e.g., `Task`, `Bug`, `User Story`) |
| `--title` | string | Yes | Title |
| `--description` | string | No | Description (HTML supported) |
| `--assignedTo` | string | No | Assign to user (display name or email) |
| `--state` | string | No | Initial state |
| `--areaPath` | string | No | Area path |
| `--iterationPath` | string | No | Iteration path |

**Examples:**

```bash
azdev workitem create --type Task --title "Fix login button"
azdev workitem create --type Bug --title "Crash on logout" --assignedTo "Jane Doe" --state Active
```

---

### `workitem update`

Update fields on an existing work item.

```
azdev workitem update <id> --fields '<json>'
```

| Argument/Option | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes | Work item ID |
| `--fields` | JSON string | Yes | JSON object of fields to update |

**Examples:**

```bash
azdev workitem update 42 --fields '{"System.State":"Done"}'
azdev workitem update 42 --fields '{"System.Title":"New title","System.AssignedTo":"john@example.com"}'
```

---

### `workitem comment`

Add a comment to a work item.

```
azdev workitem comment <id> --text <text>
```

| Argument/Option | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes | Work item ID |
| `--text` | string | Yes | Comment text (HTML supported) |

**Examples:**

```bash
azdev workitem comment 42 --text "Fixed in PR #87"
```

---

### `workitem set-state`

Update the state of a work item.

```
azdev workitem set-state <id> --state <state> [--comment <text>]
```

| Argument/Option | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes | Work item ID |
| `--state` | string | Yes | New state (e.g., `Active`, `Resolved`, `Closed`) |
| `--comment` | string | No | Optional comment to add with the state change |

**Examples:**

```bash
azdev workitem set-state 42 --state Done
azdev workitem set-state 42 --state Resolved --comment "Deployed to production"
```

---

### `workitem assign`

Assign a work item to a user.

```
azdev workitem assign <id> --to <user>
```

| Argument/Option | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes | Work item ID |
| `--to` | string | Yes | User display name or email |

**Examples:**

```bash
azdev workitem assign 42 --to "Jane Doe"
azdev workitem assign 42 --to "jane@example.com"
```

---

### `workitem link`

Create a link between two work items.

```
azdev workitem link <id> --targetId <id> --linkType <type> [--comment <text>]
```

| Argument/Option | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes | Source work item ID |
| `--targetId` | number | Yes | Target work item ID |
| `--linkType` | string | Yes | Link type reference name |
| `--comment` | string | No | Optional comment |

**Common link types:**

| Link type | Reference name |
|---|---|
| Parent | `System.LinkTypes.Hierarchy-Reverse` |
| Child | `System.LinkTypes.Hierarchy-Forward` |
| Duplicate of | `System.LinkTypes.Duplicate-Reverse` |
| Duplicate | `System.LinkTypes.Duplicate-Forward` |
| Predecessor | `System.LinkTypes.Dependency-Reverse` |
| Successor | `System.LinkTypes.Dependency-Forward` |
| Related | `System.LinkTypes.Related` |

**Examples:**

```bash
azdev workitem link 42 --targetId 10 --linkType System.LinkTypes.Hierarchy-Reverse
azdev workitem link 42 --targetId 55 --linkType System.LinkTypes.Related --comment "Blocked by this"
```

---

### `workitem bulk-create`

Create or update multiple work items in one call.

```
azdev workitem bulk-create --items '<json-array>'
```

| Option | Type | Required | Description |
|---|---|---|---|
| `--items` | JSON array string | Yes | Array of create or update params |

To create: omit `id`. To update: include `id` and a `fields` object.

**Examples:**

```bash
# Create two tasks
azdev workitem bulk-create --items '[{"workItemType":"Task","title":"Task A"},{"workItemType":"Task","title":"Task B"}]'

# Update two work items
azdev workitem bulk-create --items '[{"id":42,"fields":{"System.State":"Done"}},{"id":43,"fields":{"System.State":"Active"}}]'
```

---

## sprint

Sprint management.

### `sprint list`

List all sprints for the team.

```
azdev sprint list [--teamId <id>]
```

| Option | Type | Description |
|---|---|---|
| `--teamId` | string | Team ID (defaults to project default team) |

**Examples:**

```bash
azdev sprint list
azdev sprint list --teamId "my-team-id"
```

---

### `sprint current`

Get the current active sprint.

```
azdev sprint current [--teamId <id>]
```

| Option | Type | Description |
|---|---|---|
| `--teamId` | string | Team ID (defaults to project default team) |

**Examples:**

```bash
azdev sprint current
azdev sprint current --json
```

---

### `sprint items`

Get work items in a specific sprint.

```
azdev sprint items <sprintId> [--teamId <id>]
```

| Argument/Option | Type | Description |
|---|---|---|
| `sprintId` | string | Sprint ID (GUID or path) |
| `--teamId` | string | Team ID (optional) |

**Examples:**

```bash
azdev sprint items "Sprint 5"
azdev sprint items "abc-def-123" --teamId "my-team-id"
```

---

### `sprint capacity`

Get capacity information for a sprint.

```
azdev sprint capacity <sprintId> [--teamId <id>]
```

| Argument/Option | Type | Description |
|---|---|---|
| `sprintId` | string | Sprint ID |
| `--teamId` | string | Team ID (optional) |

**Examples:**

```bash
azdev sprint capacity "Sprint 5"
```

---

## board

Kanban board management.

### `board list`

List all boards for the team.

```
azdev board list [--teamId <id>]
```

| Option | Type | Description |
|---|---|---|
| `--teamId` | string | Team ID (optional) |

**Examples:**

```bash
azdev board list
azdev board list --markdown
```

---

### `board columns`

Get columns for a board.

```
azdev board columns <boardId> [--teamId <id>]
```

| Argument/Option | Type | Description |
|---|---|---|
| `boardId` | string | Board ID |
| `--teamId` | string | Team ID (optional) |

**Examples:**

```bash
azdev board columns "Backlog"
```

---

### `board items`

Get board and column information for a board.

```
azdev board items <boardId> [--teamId <id>]
```

| Argument/Option | Type | Description |
|---|---|---|
| `boardId` | string | Board ID |
| `--teamId` | string | Team ID (optional) |

**Examples:**

```bash
azdev board items "Backlog"
azdev board items "Backlog" --json
```

---

### `board move`

Move a work item card to a different board column.

```
azdev board move <cardId> --boardId <id> --columnId <id> [--teamId <id>] [--position <n>]
```

| Argument/Option | Type | Required | Description |
|---|---|---|---|
| `cardId` | number | Yes | Work item ID to move |
| `--boardId` | string | Yes | Board ID |
| `--columnId` | string | Yes | Target column ID |
| `--teamId` | string | No | Team ID |
| `--position` | number | No | Position within the column |

**Examples:**

```bash
azdev board move 42 --boardId "Backlog" --columnId "In Progress"
```

---

### `board members`

Get team members for a team.

```
azdev board members [--teamId <id>]
```

| Option | Type | Description |
|---|---|---|
| `--teamId` | string | Team ID (optional) |

**Examples:**

```bash
azdev board members
azdev board members --teamId "my-team-id"
```

---

## project

Project management.

### `project list`

List projects in the organization.

```
azdev project list [--top <n>] [--skip <n>] [--state <state>]
```

| Option | Type | Default | Description |
|---|---|---|---|
| `--top` | number | — | Max results |
| `--skip` | number | — | Skip N results |
| `--state` | string | — | Filter by state: `all`, `wellFormed`, `createPending`, `deleted`, `deleting`, `new`, `unchanged` |

**Examples:**

```bash
azdev project list
azdev project list --state wellFormed --top 10
```

---

### `project get`

Get details for a project.

```
azdev project get <projectId> [--capabilities]
```

| Argument/Option | Type | Description |
|---|---|---|
| `projectId` | string | Project ID or name |
| `--capabilities` | boolean | Include project capabilities |

**Examples:**

```bash
azdev project get MyProject
azdev project get MyProject --capabilities --json
```

---

### `project create`

Create a new project in the organization.

```
azdev project create --name <name> [--description <text>] [--visibility <private|public>]
```

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `--name` | string | Yes | — | Project name |
| `--description` | string | No | — | Project description |
| `--visibility` | string | No | `private` | Visibility: `private` or `public` |

**Examples:**

```bash
azdev project create --name "New Project"
azdev project create --name "Open Source App" --visibility public --description "My open source project"
```

---

### `project areas`

Get area paths for a project.

```
azdev project areas <projectId>
```

| Argument | Type | Description |
|---|---|---|
| `projectId` | string | Project ID or name |

**Examples:**

```bash
azdev project areas MyProject
```

---

### `project iterations`

Get iteration paths (sprints) for a project.

```
azdev project iterations <projectId>
```

| Argument | Type | Description |
|---|---|---|
| `projectId` | string | Project ID or name |

**Examples:**

```bash
azdev project iterations MyProject
```

---

### `project create-area`

Create a new area path in a project.

```
azdev project create-area --projectId <id> --name <name> [--parentPath <path>]
```

| Option | Type | Required | Description |
|---|---|---|---|
| `--projectId` | string | Yes | Project ID or name |
| `--name` | string | Yes | Area name |
| `--parentPath` | string | No | Parent area path |

**Examples:**

```bash
azdev project create-area --projectId MyProject --name "Backend"
azdev project create-area --projectId MyProject --name "Auth" --parentPath "MyProject\\Backend"
```

---

### `project create-iteration`

Create a new iteration (sprint) in a project.

```
azdev project create-iteration --projectId <id> --name <name> [--startDate <date>] [--finishDate <date>] [--parentPath <path>]
```

| Option | Type | Required | Description |
|---|---|---|---|
| `--projectId` | string | Yes | Project ID or name |
| `--name` | string | Yes | Iteration name |
| `--parentPath` | string | No | Parent iteration path |
| `--startDate` | string | No | Start date (ISO 8601, e.g. `2025-01-06`) |
| `--finishDate` | string | No | Finish date (ISO 8601) |

**Examples:**

```bash
azdev project create-iteration --projectId MyProject --name "Sprint 10" --startDate 2025-01-06 --finishDate 2025-01-17
```

---

### `project processes`

List available process templates.

```
azdev project processes
```

**Examples:**

```bash
azdev project processes --json
```

---

### `project work-item-types`

List work item types for a process.

```
azdev project work-item-types <processId>
```

| Argument | Type | Description |
|---|---|---|
| `processId` | string | Process ID (GUID) |

**Examples:**

```bash
azdev project work-item-types "abc-def-123"
```

---

### `project work-item-fields`

Get fields for a specific work item type in a process.

```
azdev project work-item-fields --processId <id> --witRefName <refName>
```

| Option | Type | Required | Description |
|---|---|---|---|
| `--processId` | string | Yes | Process ID (GUID) |
| `--witRefName` | string | Yes | Work item type reference name (e.g. `Microsoft.VSTS.WorkItemTypes.Task`) |

**Examples:**

```bash
azdev project work-item-fields --processId "abc-def-123" --witRefName "Microsoft.VSTS.WorkItemTypes.Bug"
```

---

## config

CLI configuration management.

### `config show`

Show the full contents of the config file.

```
azdev config show
```

**Examples:**

```bash
azdev config show
azdev config show --json
```

---

### `config set`

Set a configuration value.

```
azdev config set <key> <value>
```

| Argument | Type | Description |
|---|---|---|
| `key` | string | Config key name |
| `value` | string | Value to set |

**Examples:**

```bash
azdev config set orgUrl https://dev.azure.com/myorg
azdev config set project MyProject
azdev config set authType entra
```

For all available keys, see [configuration.md](./configuration.md).

---

### `config get`

Get a single configuration value.

```
azdev config get <key>
```

| Argument | Type | Description |
|---|---|---|
| `key` | string | Config key name |

**Examples:**

```bash
azdev config get orgUrl
azdev config get project
```
