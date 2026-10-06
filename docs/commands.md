# Command Reference

## Global Flags

These flags are available on every command:

| Flag | Description |
|---|---|
| `--json` | Output as JSON |
| `--markdown` | Output as Markdown table (arrays) or key: value pairs (objects) |
| `--project <name>` | Override the default project from config for this command only |

Work item IDs (`<id>`, `<cardId>`, `--targetId`) are validated as positive integers before any API call — invalid values exit `1`.

Exit codes: `0` success · `1` error (API failure, invalid ID/flag) · `2` config or flows file missing, incomplete or invalid.

Wherever a command takes a **sprint** (`--sprint`, or the positional of `sprint items/summary/capacity`), it accepts `current`, a bare number (`82`), a name (`Sprint 82`), a full path (`MyProject\Sprint 82`) or the iteration GUID. An unknown sprint fails before any write, suggesting close names.

Wherever a command takes a **user** (`--assignedTo`, `--to`, `assignedTo` in flows), `@me` stands for the authenticated account.

**Writes return a compact confirmation** — `id`, type, state, title, assignee, parent, sprint, tags and the browser `url` — instead of the full work item. Pass `--raw` for the full object.

---

## workitem

Work item management.

> **Note:** `list`, `mine`, `search`, `recent` and `children` hydrate their results — WIQL only returns IDs, so the CLI batch-fetches the queried fields and returns ready-to-read rows (great for `--markdown` tables). `children` always includes id/type/state/title/assignee/parent.
>
> **To understand one card, use `view`** — fields, description as text, parent, children, links, comments and image URLs in a single call.

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

Prefer `workitem query`, which builds the WIQL from flags and also counts and groups.

---

### `workitem query`

A free query. Filter flags build the WIQL; `--where` adds any condition; `--wiql` runs a whole query as given. Returns rows, a count or counts grouped by fields.

```
azdev workitem query [filters] [--where <wiql>] [--fields <csv>] [--orderBy <order>] [--top N] [--count | --groupBy <csv>] [--printWiql]
azdev workitem query --wiql "<query>" | --wiqlFile <file> [--fields <csv>] [--top N] [--count | --groupBy <csv>]
```

Filters, combined with AND:

- `--type`, `--state`: one value or several, comma-separated. `--open` leaves out finished states.
- `--mine`, `--assignedTo <user>`, `--unassigned`.
- `--sprint <sprint>`, `--area <path>` (subareas included), `--parent <id>`.
- `--tags a,b`: items carrying every tag. `--text <t>`: in the title or the description.
- `--createdSince`, `--changedSince`, `--closedSince`: `7d`, `2w`, `3m`, `1y`, `today`, `yesterday` or `YYYY-MM-DD`.
- `--where "<condition>"`: extra WIQL, where a field in brackets may go by a short name (`[priority] = 1`, `[Remaining Work] > 4`); quoted text is left alone.

Output:

- Rows by default (id, type, state, title, assignee, parent). `--fields` returns exactly those columns, in that order. `--orderBy` defaults to `changed desc`. `--top` defaults to 100 (`0` = no limit), with a warning when reached.
- `--count` → `{ count }`. `--groupBy state,assignedTo` → `{ total, groups[] }` with a `count` per combination.
- `--printWiql` → `{ wiql }` without running it.

Field names take aliases (`title`, `assignedTo`, `sprint`, `closed`, `priority`, `effort`, `remaining`…), reference names, display names and the last segment of custom fields. An unknown name fails with suggestions; `azdev metadata fields` lists them.

**Examples:**

```bash
azdev workitem query --mine --open --changedSince 14d
azdev workitem query --sprint 82 --groupBy state,assignedTo
azdev workitem query --type Publication --closedSince 30d --where "[title] CONTAINS '[PROD]'" --count
azdev workitem query --type Task --sprint current --fields id,title,remaining --orderBy "remaining desc"
azdev workitem query --sprint 82 --mine --printWiql
```

---

### `workitem progress`

How far a story is, over its whole subtree. Buckets (to do, doing, done) follow each type's state categories, so custom states (`staging`, `Committed`) land where the process puts them; removed items are counted apart.

```
azdev workitem progress <storyId>
```

Output: `story` (state, sprint, `ageDays`, `leadTimeDays` once done, `firstActivity`, `lastDelivery`), `totals`, `effort` when items carry estimates, the `sprints` the children span, `byType`, `byAssignee`, and `open[]` with how long each item has been waiting (`daysInState`).

```bash
azdev workitem progress 1200
```

---

### `workitem get`

Get a single work item by ID. Shows a slim view by default (drops avatars, links and descriptors; identity fields collapse to display names).

```
azdev workitem get <id> [--fields <csv>] [--raw]
```

| Argument/Option | Type | Description |
|---|---|---|
| `id` | number | Work item ID |
| `--fields` | csv | Only show these fields (short names like `title,state,assignedTo` or full refs like `System.Title`) |
| `--raw` | boolean | Return the full raw work item (all fields, avatars, links) |

**Examples:**

```bash
azdev workitem get 42
azdev workitem get 42 --fields title,state,assignedTo
azdev workitem get 42 --raw --json
```

---

### `workitem view`

Everything needed to understand a work item, in one call:

- the main fields (type, state, title, assignee, sprint, area, tags, priority, board column, dates) and the browser `url`;
- `description` and `acceptanceCriteria` as readable text — Markdown fields have their storage entities (`&gt;`, `&quot;`) decoded, HTML fields are turned into text with images kept as `![](url)`;
- `parent`, `children` and other work item `links`, each with id, type, state, title and assignee;
- `artifacts` (PRs, branches, commits), `hyperlinks` and `attachments`;
- the latest comments as text, and every attachment `images` URL found in the description, acceptance criteria and comments.

Empty sections are left out.

```
azdev workitem view <id> [--comments <n>]
```

| Argument/Option | Type | Default | Description |
|---|---|---|---|
| `id` | number | — | Work item ID |
| `--comments` | number | `5` | How many of the latest comments to include (`0` = none) |

**Examples:**

```bash
azdev workitem view 1200
azdev workitem view 1200 --comments 0 --json
```

---

### `workitem comments`

Read the comments of a work item, oldest first, as plain text (mentions read as `@Name` and `#id`). Returns `{ total, comments[] }` with `id`, `author`, `date`, `text`.

```
azdev workitem comments <id> [--top <n>] [--raw]
```

| Argument/Option | Type | Default | Description |
|---|---|---|---|
| `id` | number | — | Work item ID |
| `--top` | number | `20` | How many of the latest comments to return |
| `--raw` | boolean | — | Keep the stored HTML/Markdown and report each comment's `format` |

**Examples:**

```bash
azdev workitem comments 1200
```

---

### `workitem attachments`

List the attachments of a work item: files attached to it plus images embedded in the description, acceptance criteria and comments (`source` says which). `--download` saves them with the configured credential, so the token never has to leave the keychain — the output gives each local `path`, ready to open.

```
azdev workitem attachments <id> [--download <dir>]
```

| Argument/Option | Type | Description |
|---|---|---|
| `id` | number | Work item ID |
| `--download` | path | Directory to save every attachment into (created if missing). Files are named `<guid-prefix>-<fileName>`, never leaving that directory |

**Examples:**

```bash
azdev workitem attachments 1200
azdev workitem attachments 1200 --download ./wi-1200
```

---

### `workitem template`

Description templates from the `templates/` directory next to `config.json` (one `<name>.md` per work item type, or a variant such as `Publication [PROD].md`). A template is the **model** a card's description is written from — `create`, `bulk-create` and `flow apply` refuse a card of that type whose description is missing, still the untouched template, or still holding the template's `<…>` prompts, and warn when it leaves out one of the template's `##` sections.

```
azdev workitem template [name] [--title <t>] [--parent <id>]
```

| Argument/Option | Type | Description |
|---|---|---|
| `name` | string | Template to print as raw Markdown; without it, list the templates and their sections |
| `--title` | string | Fill `{title}` with the card's title |
| `--parent` | number | Fill `{parentId}` and `{parentTitle}` from this parent (reads it) |

Placeholders that are not given stay visible.

**Examples:**

```bash
azdev workitem template
azdev workitem template "Publication [PROD]" --title "Checkout [PROD]" --parent 1200
```

---

### `workitem children`

List the children of a work item. Direct children by default; use `--recursive` for the whole subtree. Results are hydrated (id, type, state, title, assignee, parent).

```
azdev workitem children <id> [--recursive] [--mine] [--open] [--state <s>] [--type <t>]
```

| Argument/Option | Type | Description |
|---|---|---|
| `id` | number | Parent work item ID |
| `--recursive` | boolean | Include the whole subtree, not just direct children |
| `--mine` | boolean | Only items assigned to me |
| `--open` | boolean | Exclude finished states (Done/Closed/Removed/Completed) |
| `--state` | string | Exact state filter |
| `--type` | string | Work item type filter (e.g. `Task`, `Bug`) |

**Examples:**

```bash
azdev workitem children 7692
azdev workitem children 7692 --mine --open --markdown
azdev workitem children 7692 --recursive --type Task
```

---

### `workitem history`

The timeline of a work item: one row per revision that changed a followed field or carries a comment, with `rev`, `date`, `by`, `changes` (`Field: old → new | …`) and `comment`. Revisions that only touched bookkeeping fields are left out.

```
azdev workitem history <id> [--fields <csv>] [--allFields] [--maxText <n>] [--raw]
```

| Argument/Option | Type | Default | Description |
|---|---|---|---|
| `id` | number | — | Work item ID |
| `--fields` | csv | state, reason, owner, title, type, sprint, tags, board column, parent, dates, work, description | Fields to follow (short or full names) |
| `--allFields` | boolean | — | Follow every field |
| `--maxText` | number | `240` | Truncate long values (`0` = no limit) |
| `--raw` | boolean | — | The raw revisions (one full snapshot per revision) |

**Examples:**

```bash
azdev workitem history 42
azdev workitem history 42 --fields state,assignedTo
azdev workitem history 42 --raw --json
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
azdev workitem mine [--sprint <sprint>] [--state <state>] [--open] [--top <n>]
```

| Option | Type | Default | Description |
|---|---|---|---|
| `--sprint` | string | — | Only this sprint (`current`, `82`, `Sprint 82`, path) |
| `--state` | string | — | Filter by exact state (e.g., `Active`, `Resolved`) |
| `--open` | boolean | — | Exclude finished states (Done/Closed/Removed/Completed) |
| `--path` | string | — | Filter by full iteration path (prefer `--sprint`; not both) |
| `--top` | number | `100` | Max results |

**Examples:**

```bash
azdev workitem mine
azdev workitem mine --open
azdev workitem mine --sprint current --open
azdev workitem mine --state Active
```

---

### `workitem inbox`

What reached you since the last check: cards assigned to you that someone else changed (a card created for you counts), cards someone else took from you, changes others made to the cards you watch ([`workitem watch`](#workitem-watch)) and their children, and comments that mention you. Each card's history is read, so a change of yours after a colleague's does not hide theirs, and a card no longer in your name still shows up. Each run moves the last check to the moment it started and archives the watched cards that finished; the last check is kept per project in `inbox.json`, next to `config.json` (`azdev config paths`). The first check looks back one day.

```
azdev workitem inbox [--since <when>] [--peek]
```

| Option | Type | Description |
|---|---|---|
| `--since` | string | Look back from `7d`, `2w`, `today`, `yesterday` or `YYYY-MM-DD` instead of the last check |
| `--peek` | boolean | Leave the last check and the watch list where they are |

Output:
- `since` — start of the window.
- `assigned[]` — id, type, state, title, `ChangedBy` (everyone else who changed it in the window, latest first), `ChangedDate` (the latest of their changes), `change` (`new` when the card was created in the window, else `changed`) and `url`.
- `removed[]` — cards someone else reassigned or left with no assignee in the window (the ones you handed over yourself are left out): id, type, state, title, `AssignedTo` (where it is now; empty when nobody), `RemovedBy`, `RemovedDate` (the latest time it left you) and `url`.
- `watched[]` — the watched cards and their direct children, not assigned to you, that someone else changed in the window: id, `Watched` (the watched card it belongs to), type, state, title, `AssignedTo`, `ChangedBy`, `ChangedDate`, `change` and `url`. A card already in `assigned` or `removed` is not repeated.
- `closed[]` — watched cards that finished: done or removed by state category (a custom state such as `published` counts by its category), **and so is every direct child**. A story that looks done while its review or publication card is still open stays watched. A check without `--peek` moves these to the archive: id, type, state, title and `url`.
- `mentions[]` — one row per comment that mentions you, newest first, leaving out your own: card `id`, `Title`, `author`, `date`, `text` and `url`.

A mention is your identity id inside the comment (`data-vss-mention` in HTML, `@<id>` in Markdown). The cards searched are the ones the `@RecentMentions` WIQL macro returns, which covers the last 30 days.

**Examples:**

```bash
azdev workitem inbox
azdev workitem inbox --since 7d --peek
```

---

### `workitem watch`

Follow a card besides your own: `workitem inbox` lists the changes others make to it and to its direct children. Made for a story whose review, tests and publication cards are other people's. Prints the watch list after the change. The list is kept per project in `watch.json`, next to `config.json`; a malformed file exits `1` and is left untouched, so the next save never overwrites it. `flow apply` watches its story by itself.

```
azdev workitem watch [<id>] [--remove] [--archived]
```

| Option | Type | Description |
|---|---|---|
| `<id>` | positional | Card to watch; a card that does not exist exits `1`, and an archived one comes back to the list. No id lists the watched cards |
| `--remove` | boolean | Stop watching the card given; also drops it from the archive. A card not watched exits `1` |
| `--archived` | boolean | List the archive instead: watched cards that finished with all their children, moved there by `workitem inbox` |

Rows: id, type, state, title, `AssignedTo`, `since` (when watching started), `url`; the archive adds `archivedAt`.

**Examples:**

```bash
azdev workitem watch 14547
azdev workitem watch
azdev workitem watch 14547 --remove
azdev workitem watch --archived
```

---

### `workitem create`

Create a new work item. Parent link, tags and sprint go in the **same request** — no follow-up `update`/`link` calls.

```
azdev workitem create --type <type> --title <title> [options]
```

| Option | Type | Required | Description |
|---|---|---|---|
| `--type` | string | Yes | Work item type (e.g., `Task`, `Bug`, `User Story`) |
| `--title` | string | Yes | Title |
| `--parent` | number | No | Parent work item. Area and sprint are inherited from it unless given — like "add child" on the board |
| `--tags` | string | No | Tags separated by `;` or `,` |
| `--sprint` | string | No | Sprint (`current`, `82`, `Sprint 82`, path) |
| `--description` | string | No | Description (HTML by default; Markdown with `--format markdown`) |
| `--descriptionFile` | path | No | Read the description from a file (`-` = stdin) — keeps long text out of shell quoting |
| `--template` | string | No | Template the description is written from (default: `templates/<type>.md`, when it exists). The description is then required and checked against it |
| `--noTemplate` | boolean | No | Skip the template check |
| `--assignedTo` | string | No | Assign to user (display name, email or `@me`) |
| `--state` | string | No | Initial state |
| `--areaPath` | string | No | Area path |
| `--iterationPath` | string | No | Iteration path (prefer `--sprint`; not both) |
| `--format` | `html` \| `markdown` | No | Rich-text format for the description; default: config `richTextFormat`, else HTML |
| `--dryRun` | boolean | No | Print the resolved request (fields, parent link) without creating |
| `--raw` | boolean | No | Return the full created work item |

Type or state name uncertain? Run `azdev metadata types --type <name>`. An invalid state fails with the list of the type's valid states.

When a template applies (see `workitem template`), write the description from it with the task's own content: a missing description, the untouched template or a leftover `<…>` prompt fails before anything is sent; a template section left out prints a warning. The confirmation reports the `template` used, and the description is written as Markdown.

**Examples:**

```bash
azdev workitem create --type Task --title "Fix login button"
azdev workitem create --type Task --title "Adjust checkout" --parent 1200 --assignedTo @me --tags "backend"
azdev workitem create --type "technical tests" --title "Checkout tests" --parent 1200 \
  --descriptionFile ./tests.md --format markdown --sprint current
azdev workitem create --type Task --title "After the release" --parent 1300 --sprint 100 --dryRun
```

---

### `workitem update`

Update fields on an existing work item.

```
azdev workitem update <id> [--fields '<json>'] [--title <t>] [--descriptionFile <path>] [--sprint <s>] [--format html|markdown]
```

| Argument/Option | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes | Work item ID |
| `--fields` | JSON string | No | JSON object of fields to update (reference names) |
| `--title` | string | No | New title |
| `--descriptionFile` | path | No | Replace the description with a file's contents (`-` = stdin) |
| `--sprint` | string | No | Move to a sprint (`current`, `82`, `Sprint 82`, path) |
| `--format` | `html` \| `markdown` | No | Rich-text format for multiline fields (Description, AcceptanceCriteria, ReproSteps, History); default: config `richTextFormat` |
| `--raw` | boolean | No | Return the full updated work item |

At least one of `--fields`, `--title`, `--descriptionFile` or `--sprint` is required.

Rich-text fields (e.g. `System.Description`) render as **HTML** by default — raw Markdown shows up literally. Pass `--format markdown` (or set `richTextFormat`) to have Azure DevOps render Markdown. The format only sticks when the field's **content also changes** in the same update (setting format alone on identical text is a no-op).

**Examples:**

```bash
azdev workitem update 42 --fields '{"System.State":"Done"}'
azdev workitem update 42 --title "Checkout [PROD]" --sprint 83
azdev workitem update 42 --descriptionFile ./spec.md --format markdown
```

---

### `workitem comment`

Add a comment to a work item.

```
azdev workitem comment <id> (--text <text> | --file <path>) [--format html|markdown]
```

| Argument/Option | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes | Work item ID |
| `--text` | string | One of | Comment text |
| `--file` | path | One of | Read the comment from a file (`-` = stdin) |
| `--format` | `html` \| `markdown` | No | `markdown` keeps line breaks and `#id` links; `html` (the API default) collapses `\n` into spaces. Default: config `richTextFormat` |
| `--raw` | boolean | No | Return the full comment object |

Markdown comments go through the comments API version that accepts a format; if the server still stores HTML, a warning is printed.

> **Note:** `#<number>` autolinks to a work item (e.g. `#42` → work item 42). Don't prefix
> non-work-item ids (PRs, builds) with `#` or they link to the wrong item — use a full URL.

**Examples:**

```bash
azdev workitem comment 42 --text "Fixed in PR: https://github.com/myorg/myrepo/pull/87"
azdev workitem comment 1201 --file ./retest.md --format markdown
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
| `--raw` | boolean | No | Return the full updated work item |

States differ per type (an `Issue` may have no `Removed`). When the API rejects the state, the error lists the valid states of that item's type.

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
| `--to` | string | Yes | User display name, email or `@me` |
| `--raw` | boolean | No | Return the full updated work item |

**Examples:**

```bash
azdev workitem assign 42 --to "Jane Doe"
azdev workitem assign 42 --to "jane@example.com"
azdev workitem assign 42 --to @me
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
| `--raw` | boolean | No | Return `{ count, workItems }` with the full objects |

To create: omit `id` (`workItemType`, `title`, and optionally `parentId`, `tags`, `sprint`, `assignedTo`, `description`, `format`…). To update: include `id` and a `fields` object. Returns one compact confirmation per item. To create the standard cards of a story, prefer `flow apply`.

**Examples:**

```bash
# Create two tasks under story 1200
azdev workitem bulk-create --items '[{"workItemType":"Task","title":"Task A","parentId":1200},{"workItemType":"Task","title":"Task B","parentId":1200}]'

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

The work items of a sprint as hydrated rows (id, type, state, title, assignee, parent), with filters.

```
azdev sprint items [sprint] [--mine] [--assignedTo <user>] [--type <t>] [--state <s>] [--open] [--teamId <id>]
```

| Argument/Option | Type | Default | Description |
|---|---|---|---|
| `sprint` | string | `current` | Sprint (`current`, `82`, `Sprint 82`, path, GUID) |
| `--mine` | boolean | — | Only items assigned to me |
| `--assignedTo` | string | — | Only items assigned to this user (email or display name) |
| `--type` | string | — | Work item type filter |
| `--state` | string | — | Exact state filter |
| `--open` | boolean | — | Exclude finished states |
| `--teamId` | string | — | Team for `current` (default team otherwise) |

**Examples:**

```bash
azdev sprint items --mine --open
azdev sprint items 82 --type Publication
azdev sprint items "Sprint 100" --assignedTo alice@example.com
```

---

### `sprint summary`

A person's delivery in a sprint, grouped by **story** (parent) rather than counted per card. Per story: the person's cards in the sprint (`inSprint`) and the rest of its cycle (`cycle` — other people's review, QA and publication cards, any sprint, with their `Sprint`). Operational work (support, meetings, hot fixes) is kept apart, cards with no parent are listed as `orphans`, and `totals` count by type. Removed cards are left out.

```
azdev sprint summary [sprint] [--assignedTo <user>] [--operational <csv>] [--teamId <id>]
```

| Argument/Option | Type | Default | Description |
|---|---|---|---|
| `sprint` | string | `current` | Sprint |
| `--assignedTo` | string | you | Whose delivery (email or display name) |
| `--operational` | csv | `operationalTypes` from flows.json | Types kept apart from product work |
| `--teamId` | string | — | Team for `current` |

**Examples:**

```bash
azdev sprint summary 81
azdev sprint summary current --assignedTo alice@example.com --operational "Support,meetings"
```

---

### `sprint progress`

How far a sprint is: items to do, doing and done (by state category), % done against the share of working days elapsed (`pace`: ahead, on track or behind), by state, by type and by assignee, and effort when the items carry estimates.

```
azdev sprint progress [sprint] [--mine] [--assignedTo <user>] [--type <csv>] [--product] [--daily] [--teamId <id>]
```

- `sprint` defaults to `current`. `daysElapsed` does not count today, which is still under way.
- `--daily` adds the items and done items at the end of each working day so far: a burn-up that also shows work added mid-sprint (two queries per day).
- `--product` leaves out the `operationalTypes` of flows.json.

```bash
azdev sprint progress
azdev sprint progress 82 --mine --daily
```

---

### `sprint carryover`

Work pushed from sprint to sprint. An item counts as carried once for every earlier sprint it was still unfinished in at that sprint's end, read as the board was then (ASOF queries). For a finished sprint, it also tells where each unfinished item went.

```
azdev sprint carryover [sprint] [--mine] [--assignedTo <user>] [--type <csv>] [--product] [--open] [--lookback N] [--teamId <id>]
```

- `--lookback N`: earlier sprints to check (default 6). `--open`: only items not finished yet.
- Sprints listed in flows.json `backlogSprints` are waiting lists, never counted as a sprint an item was carried from.
- Items fitting a card with `expectedCarryover: true` (a production publication waiting for its deploy window) are listed under `expected`, out of the count.
- `carriedOut` (finished sprints only) sorts the unfinished items into `moved`, `parked` (now in a backlog sprint), `expected`, `closed late`, `still open` and `removed`.
- Earlier sprints are the team's sprints that started before this one and ended by its first day; overlapping sprints are not earlier.

```bash
azdev sprint carryover --mine
azdev sprint carryover 81 --lookback 10
```

---

### `sprint capacity`

Get capacity for a sprint. Returns per-member activities (`name`, `capacityPerDay`) and days off, plus team totals (`totalCapacityPerDay`, `totalDaysOff`).

```
azdev sprint capacity [sprint] [--teamId <id>]
```

| Argument/Option | Type | Default | Description |
|---|---|---|---|
| `sprint` | string | `current` | Sprint (`current`, `82`, `Sprint 82`, path, GUID) |
| `--teamId` | string | — | Team ID (optional) |

**Examples:**

```bash
azdev sprint capacity
azdev sprint capacity 82
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

List the cards on a board as slim work items (id, title, state, type, assignee, board column). Items without a board column value are skipped. Results are capped at 200; a warning is printed on stderr when the cap is hit.

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

Move a work item card to another board column — updates the board's column field on the work item. If the column does not exist, the command fails and lists the available columns. Returns `{ id, board, column }`.

```
azdev board move <cardId> --boardId <id> --columnId <id-or-name> [--teamId <id>]
```

| Argument/Option | Type | Required | Description |
|---|---|---|---|
| `cardId` | number | Yes | Work item ID to move |
| `--boardId` | string | Yes | Board ID (get it from `board list`) |
| `--columnId` | string | Yes | Target column — accepts column ID or column name |
| `--teamId` | string | No | Team ID |

**Examples:**

```bash
azdev board move 42 --boardId "Backlog" --columnId "In Progress"
```

---

### `board members`

Get team members. Returns slim rows: `displayName`, `uniqueName`, and `isTeamAdmin` (when true). Defaults to the project's default team when `--teamId` is omitted.

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
| `--visibility` | string | No | `private` | Visibility: `private` or `public` — any other value exits `1` |

**Examples:**

```bash
azdev project create --name "New Project"
azdev project create --name "Open Source App" --visibility public --description "My open source project"
```

---

### `project areas`

Get the area tree of a project, flattened to `{ name, path }` rows. `path` is field-ready — usable directly as `System.AreaPath` (e.g. `MyProject\Backend`).

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

Get the iteration tree of a project, flattened to `{ name, path, startDate, finishDate }` rows. `path` is field-ready — usable directly as `System.IterationPath`.

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

List available process templates. Returns slim rows: `{ id, name, description, isDefault }`.

```
azdev project processes
```

**Examples:**

```bash
azdev project processes --json
```

---

### `project work-item-types`

List work item types for a **process** (requires a process ID from `project processes`). For the current project's types and states, use `azdev metadata types` instead.

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

Get fields for a specific work item type in a process. Returns slim rows: `{ referenceName, name, type, required }`.

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

## metadata

Project metadata — runs against the configured project (or `--project`).

### `metadata types`

List the work item types available in the project. Slim by default: `name`, `referenceName`, `description`, `states` (state names). Use it to discover valid types and states before `workitem create` / `set-state`.

```
azdev metadata types [--type <name>] [--raw]
```

| Option | Type | Description |
|---|---|---|
| `--type` | string | Only this type (case-insensitive) — the quick way to check its states. An unknown type exits `1` listing the types |
| `--raw` | boolean | Full raw types (color, icon, fields, transitions) |

**Examples:**

```bash
azdev metadata types
azdev metadata types --type Issue
azdev metadata types --markdown
```

---

### `metadata fields`

List the project's fields (`referenceName`, `name`, `type`) — the names `workitem query` takes in `--fields`, `--groupBy`, `--orderBy` and `--where`.

```
azdev metadata fields [--search <text>] [--raw]
```

- `--search`: only fields whose name or reference name contains the text. `--raw`: the full field objects.

```bash
azdev metadata fields --search date
```

---

### `metadata tags`

List the tags defined in the project. Slim by default: names only.

```
azdev metadata tags [--raw]
```

| Option | Type | Description |
|---|---|---|
| `--raw` | boolean | Full raw tags (id, lastUpdated, url) |

**Examples:**

```bash
azdev metadata tags
```

---

## flow

Story cycles. A **flow** lists the child cards a story is expected to have — implementation, technical tests, code review, QA, publication — so the CLI can create the missing ones in one call and audit a story (or a whole sprint) before someone else does.

Flows live in `flows.json`, next to `config.json` (`~/.config/azdev/flows.json`; it follows `AZDEV_CONFIG_PATH`/`XDG_CONFIG_HOME`). A missing or invalid file exits `2`, listing every problem.

```json
{
  "operationalTypes": ["Support", "meetings", "hot fix"],
  "backlogSprints": ["Sprint 100"],
  "flows": {
    "story": {
      "description": "Story with code",
      "parentTypes": ["Product Backlog Item"],
      "cards": [
        { "key": "impl", "type": "Task", "title": "Implementation: {title}", "assignedTo": "@me", "state": "To Do" },
        {
          "key": "tests", "type": "technical tests", "title": "Technical tests: {title}", "assignedTo": "@me",
          "requireDescription": true, "retestAfter": ["Task", "Issue", "Bug Fix"],
          "description": "## What was tested\n\n## How\n\n## Result\n"
        },
        { "key": "review", "type": "Review", "title": "Code review: {title}", "assignedTo": "reviewer@example.com" },
        { "key": "pub-hml", "type": "Publication", "title": "{title} [HOMOLOG]", "match": "\\[\\s*HOMOLOG\\s*\\]", "optional": true },
        { "key": "pub-prod", "type": "Publication", "title": "{title} [PROD]", "match": "\\[\\s*PROD\\s*\\]", "expectedCarryover": true }
      ]
    }
  }
}
```

Card fields:

- **`key`, `type`, `title`** (required). `title` and `description` take `{title}` and `{id}` of the story.
- **`match`**: case-insensitive regex an existing child's title must match to count as this card. Without it, any child of `type` counts. Two cards of the same type need distinct `match` patterns — the file is rejected otherwise, since `apply` would otherwise recreate a card on every run.
- **`assignedTo`, `state`, `tags`, `sprint`**: what `apply` creates the card with. Without `sprint`, the card lands in the story's sprint.
- **`template`, `description`**: the model the card's description is written from — `description` inline (with the story's `{title}`/`{id}`), else the `templates/` file named by `template`, else the one named after `type`. The descriptions themselves come from `apply --descriptions`.
- **`optional`**: `status` does not flag it as missing, and `apply` only creates it with `--with <key>`.
- **`requireDescription`**: `status` flags the card when its description is empty or still the untouched template.
- **`retestAfter`**: types whose closing *after* this card makes it stale — a fix landing after the technical tests. A comment on the card, or another card of the same key, closed after the fix clears it.
- **`expectedCarryover`**: the card changes sprints by design (a production publication waiting for its deploy window), so `sprint carryover` lists it apart instead of counting it as work pushed forward.

`operationalTypes` feeds `sprint summary` and the `--product` flag of the stats commands. `backlogSprints` names the sprints used as a waiting list: `sprint carryover` never counts them as a sprint an item was carried from, `stats throughput` leaves them out and `stats aging` leaves their items out unless `--includeParked`. `parentTypes` lets `status`/`apply` pick the flow from the story's type; otherwise pass `--flow <name>`.

Children in state `Removed` count as absent.

### `flow list`

The flows defined in `flows.json`, compact.

```
azdev flow list
```

---

### `flow status`

Audit a story against its flow: one row per card (`done`, `open`, `missing`, `skipped`) with its ids, states and assignees, `findings` in plain words, and `others` — children that fit no card. With `--sprint`, audits every story of a sprint and returns one row per story (`missing` cards, number of `findings`) plus the findings list.

Findings it reports:

- a required card is missing — and, when a child of the same type exists with a title that misses the `match` (a publication without `[PROD]`), it names that child;
- a `requireDescription` card has no description;
- a `retestAfter` card was closed before a later fix, with no comment or new card since.

```
azdev flow status <storyId> [--flow <name>]
azdev flow status --sprint <sprint> [--mine] [--teamId <id>]
```

| Argument/Option | Type | Description |
|---|---|---|
| `storyId` | number | Story (parent) work item ID |
| `--flow` | string | Flow name (default: the one whose `parentTypes` include the story's type). With `--sprint`, every story is audited with it. When several flows apply to a story's type, the command fails asking for `--flow` |
| `--sprint` | string | Audit every story of this sprint that has a flow |
| `--mine` | boolean | With `--sprint`: only stories holding one of my cards in that sprint |

**Examples:**

```bash
azdev flow status 1200
azdev flow status --sprint current --mine
```

---

### `flow apply`

Create, as children of the story, the cards of its flow that it does not have yet. **Idempotent**: a card that already exists (same type, title matching `match`) is reported as `exists` and never created twice, so re-running after a failure only creates what is still missing. Optional cards are created only when asked.

```
azdev flow apply <storyId> [--flow <name>] [--only <keys>] [--skip <keys>] [--with <keys>] [--sprint <s>] [--name <feature>] [--titles <json>] [--descriptions <dir>] [--noTemplate] [--dryRun]
```

| Argument/Option | Type | Description |
|---|---|---|
| `storyId` | number | Story (parent) work item ID |
| `--flow` | string | Flow name (default: picked from the story's type) |
| `--only` | csv | Only these card keys (optional ones included) |
| `--skip` | csv | Every card except these keys |
| `--with` | csv | Optional card keys to create too |
| `--sprint` | string | Sprint for every created card, over the card's own `sprint` and the story's |
| `--name` | string | Feature name for `{title}` in the cards' titles, instead of the story's title (`{parentTitle}` in templates stays the story's) |
| `--titles` | json | Whole titles by card key, e.g. `{"pub-prod":"Deploy API + app [PROD]"}`. Each must still match its card's `match`, or the row is a `conflict` |
| `--descriptions` | path | Directory with one `<key>.md` per card to create — the card's own description, written from its template |
| `--noTemplate` | boolean | Create without descriptions, skipping the template requirement |
| `--dryRun` | boolean | Show the plan (`exists`, `would-create`, `skipped`) with resolved assignee and sprint, the `template` each card follows and whether its `description` is there, without creating |

A card that has a model (template file or inline `description`) needs its `<key>.md`. A missing, untouched or unknown-key description fails before **any** card is created, so the story is never left half-built.

An unknown card key exits `1` before anything is created. Each row reports `key`, `action`, `ids`, `type`, `title`, `assignedTo`, `state`, `sprint`.

Without `--dryRun` the story is added to the watch list ([`workitem watch`](#workitem-watch)) and the output carries `watching: true`: its review, tests and publication cards usually go to other people, and the inbox brings the changes they make.

A card whose title, rendered with the story's real title, would count as another card (a story named `… [HOMOLOG]` makes `{title} [PROD]` match the homolog pattern) is reported as `conflict` and not created — creating it would break idempotency. The reasons are listed under `conflicts`; tighten the other card's `match`.

**Examples:**

```bash
azdev flow apply 1300 --dryRun
azdev flow apply 1300
azdev flow apply 1300 --with pub-hml --skip qa --sprint 100
azdev flow apply 1300 --name "Private files bucket" --titles '{"pub-prod":"Deploy API + portal [PROD]"}' --dryRun
```

---

## stats

Delivery numbers over time. Every stats command takes `--mine`, `--assignedTo <user>`, `--type <csv>`, `--product` (leaves out the `operationalTypes` of flows.json) and `--teamId <id>` (whose sprints). Done means the Completed state category of each type; removed items never count. Sprint progress and carry-over live under `sprint`, a story's progress under `workitem progress`.

### `stats throughput`

Delivered items per sprint or per week, with average and median over the finished periods.

```
azdev stats throughput [--by sprint|week] [--last N] [filters]
```

- `--by sprint` (default): the team's last `N` started sprints (default 6), each with `planned` and `done` as they stood at its end, `donePct`, `notDone` and `current` for a sprint still running. Backlog sprints are left out.
- `--by week`: items closed per ISO week.

```bash
azdev stats throughput --mine
azdev stats throughput --by week --last 8 --product
```

---

### `stats cycle-time`

How long delivered items took: lead time (created → closed) and cycle time (activated → closed), as `avg`, `median`, `p85` and `max` in days, by type or by assignee, with the five slowest items.

Both measure the cards, so `boardHabits` says how far they measure the work: items created less than an hour before closing (`createdNearClose`), items that entered an in-progress state less than an hour before closing (`activatedNearClose`) and items never activated (`neverActivated`). When those shares are high, a `caveat` says so: on a board where cards move to in progress right before closing, cycle time comes out near zero whatever the work took, and lead time is the steadier measure.

```
azdev stats cycle-time [--since <date> | --sprint <sprint>] [--by type|assignedTo|none] [filters]
```

- `--since` defaults to `90d`; `--sprint` takes the done items of a sprint instead.

```bash
azdev stats cycle-time --mine
azdev stats cycle-time --sprint 81 --by assignedTo --product
```

---

### `stats aging`

Open items by how long they have sat in their current state, oldest first, with a distribution (`0-7` … `91+` days). `inFinishedSprints` counts open items left behind in a sprint already over (`sprintOver` on each row).

```
azdev stats aging [--sprint <sprint>] [--state <csv>] [--inProgress] [--minDays N] [--top N] [--includeParked] [filters]
```

- `--inProgress`: only items already started — what is stuck, not what waits to start.
- Items of flows.json `backlogSprints` are left out (`parkedLeftOut`) unless `--includeParked`.

```bash
azdev stats aging --mine --top 10
azdev stats aging --inProgress --minDays 14
```

---

## config

CLI configuration management.

### `config show`

Show the config file contents. Credentials (`personalAccessToken`, `password`) are
always redacted as `***`; a `credentialSource` field reports where the credential is
resolved from — `env`, `keychain` or `none`.

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

Set a configuration value. `personalAccessToken` and `password` go to the OS
keychain instead of the config file; every other key is written to
`~/.config/azdev/config.json` with mode `0600`.

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
azdev config set personalAccessToken <your-token>   # stored in the keychain
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

Credential keys return `***` rather than the stored value.

**Examples:**

```bash
azdev config get orgUrl
azdev config get project
```

---

### `config paths`

Where the per-user files live, and whether each exists: `config` (`config.json`), `flows` (`flows.json`, read by `flow` and `sprint summary`), `conventions` (`conventions.md`, read by the Claude Code plugin's skills), `templates` (the description templates directory), `inbox` (`inbox.json`, the last check of `workitem inbox`) and `watch` (`watch.json`, the cards followed by `workitem watch`). All sit in the same directory, so `AZDEV_CONFIG_PATH` and `XDG_CONFIG_HOME` move them together.

```
azdev config paths
```

---

### `config unset`

Remove a configuration value, or delete a stored credential from the OS keychain.

```
azdev config unset <key>
```

| Argument | Type | Description |
|---|---|---|
| `key` | string | Config key name |

Exits `1` when the key was not set.

**Examples:**

```bash
azdev config unset collection
azdev config unset personalAccessToken   # removes it from the keychain
```
