# azdev command reference

Every subcommand with every flag. Flags are camelCase. `azdev <group> <sub> --help` prints the same flags from the binary itself.

**Global flags (every API command):** `--json`, `--markdown` (output format; default toon), `--project <name>` (override the configured project).

**Value forms used below:**
- *sprint* — `current`, a bare number (`82`), a name (`Sprint 82`), a full path (`Project\Sprint 82`) or the iteration GUID. Unknown or ambiguous values fail before any write and suggest close names.
- *user* — email, display name, or `@me` for the authenticated account.
- *file* — a path, or `-` for stdin.

**Writes** (`create`, `update`, `set-state`, `assign`, `link`, `bulk-create`) print a compact confirmation — id, type, state, title, assignee, parent, sprint, tags, browser `url`. `--raw` returns the full work item.

---

## workitem

### workitem view

`azdev workitem view <id> [--comments N]` — the one-call context of a card.

- `<id>` work item ID.
- `--comments N` latest comments to include (default 5; `0` = none).

Output: main fields (type, state, title, assignee, sprint, area, tags, priority, board column, dates) and `url`; `description` and `acceptanceCriteria` as text (Markdown fields decoded, HTML converted, images kept as `![](url)`); `parent`, `children`, `links` (id, type, state, title, assignee); `artifacts` (PRs, branches, commits), `hyperlinks`, `attachments`; `comments` (`total`, `shown`, `items`); `images` (every attachment URL found). Empty sections are omitted.

### workitem get

`azdev workitem get <id> [--fields <csv>] [--raw]`

- `--fields` only these fields — short (`title,state,assignedTo`) or full (`System.Title`) names.
- `--raw` the full API object (all fields, identities, links). Use it to read an identity `id` for mentions.

### workitem comments

`azdev workitem comments <id> [--top N] [--raw]` — `{ total, comments[] }` with `id`, `author`, `date`, `text`, oldest first.

- `--top N` latest comments to return (default 20).
- `--raw` keep the stored HTML/Markdown and add each comment's `format`.

### workitem attachments

`azdev workitem attachments <id> [--download <dir>]` — attached files plus images inline in the description, acceptance criteria and comments; `source` says which.

- `--download <dir>` saves every attachment with the configured credential (dir created if missing) and returns each local `path` and `bytes`. Files are named `<guid-prefix>-<fileName>` and stay inside `dir`.

### workitem history

`azdev workitem history <id> [--fields <csv>] [--allFields] [--maxText N] [--raw]` — one row per revision that changed a followed field or carries a comment: `rev`, `date`, `by`, `changes` (`Field: old → new | …`), `comment`.

- `--fields` fields to follow (short or full names). Default: title, type, state, reason, assignee, sprint, tags, board column, parent, activated/resolved/closed dates, scheduling dates and work, description.
- `--allFields` follow every field.
- `--maxText N` truncate long values (default 240; `0` = no limit).
- `--raw` the raw revisions (one full snapshot each).

### workitem children

`azdev workitem children <id> [--recursive] [--mine] [--open] [--state <s>] [--type <t>]` — hydrated rows: id, type, state, title, assignee, parent.

- `--recursive` the whole subtree.
- `--mine` only mine. `--open` exclude Done/Closed/Removed/Completed. `--state` exact state. `--type` exact type.

### workitem mine

`azdev workitem mine [--sprint <sprint>] [--state <s>] [--open] [--top N]` — my items, newest first.

- `--sprint` only that sprint. `--path` full iteration path instead (not both).
- `--state` exact state. `--open` exclude finished states. `--top N` max rows (default 100).

### workitem search

`azdev workitem search <query> [--top N]` — text in title or description, newest first. `--top N` max rows.

### workitem recent

`azdev workitem recent [--top N] [--skip N]` — recently changed items (default `--top 10 --skip 0`).

### workitem list

`azdev workitem list [--query <wiql>]` — raw WIQL, hydrated with the queried columns. Default query: every item of the project, newest first. Prefer the commands above; use WIQL only for a filter they lack.

### workitem create

`azdev workitem create --type <t> --title <t> [options]` — one request, parent link included.

- `--type`, `--title` required. Unsure of the type name: `azdev metadata types`.
- `--parent <id>` child of this item; area and sprint come from the parent unless given.
- `--tags` separated by `;` or `,`.
- `--sprint <sprint>` or `--iterationPath <path>` (not both). `--areaPath <path>`.
- `--description <text>` or `--descriptionFile <file>` (not both).
- `--assignedTo <user>`. `--state` initial state.
- `--format html|markdown` format of the description; default: config `richTextFormat`, else HTML.
- `--dryRun` print the resolved request (fields, parent link, resolved user and sprint) without creating.
- `--raw` full created item.

### workitem update

`azdev workitem update <id> [--fields <json>] [--title <t>] [--descriptionFile <file>] [--sprint <sprint>] [--format html|markdown] [--raw]` — at least one change is required.

- `--fields` JSON object keyed by reference name: `'{"System.State":"Active","System.Tags":"a; b"}'`. An empty string clears a field.
- `--title`, `--descriptionFile`, `--sprint` shortcuts for the common fields.
- `--format` only sticks when the field's content also changes in the same call.

### workitem comment

`azdev workitem comment <id> (--text <t> | --file <file>) [--format html|markdown] [--raw]`

- `--format markdown` keeps line breaks and `#id` links; HTML (the API default) collapses `\n` into spaces. Default: config `richTextFormat`. A warning is printed if the server still stores HTML.
- `--raw` the full comment object.

### workitem set-state

`azdev workitem set-state <id> --state <s> [--comment <t>] [--raw]` — an invalid state fails with the valid states of that item's type. `--comment` goes to the item's history.

### workitem assign

`azdev workitem assign <id> --to <user> [--raw]`

### workitem link

`azdev workitem link <id> --targetId <id> --linkType <type> [--comment <t>] [--raw]` — `<id>` is the source.

Link types: `System.LinkTypes.Hierarchy-Forward` (child), `System.LinkTypes.Hierarchy-Reverse` (parent), `System.LinkTypes.Related`, `System.LinkTypes.Dependency-Forward` (successor), `System.LinkTypes.Dependency-Reverse` (predecessor), `System.LinkTypes.Duplicate-Forward` / `-Reverse`.

### workitem bulk-create

`azdev workitem bulk-create --items '<json-array>' [--raw]` — one entry per item, run in order and not atomic: after a failure the earlier items already exist, so check with `workitem children <parentId>` before re-running (unlike `flow apply`, a re-run creates them again).

- Create: `{"workItemType":"Task","title":"A","parentId":1200,"tags":"x","sprint":"current","assignedTo":"@me","description":"…","format":"markdown"}`.
- Update: `{"id":42,"fields":{"System.State":"Done"}}`.
- `--raw` returns `{ count, workItems }` with full objects. For a story's standard cards, prefer `flow apply`.

---

## sprint

### sprint items

`azdev sprint items [sprint] [--mine] [--assignedTo <user>] [--type <t>] [--state <s>] [--open] [--teamId <id>]` — hydrated rows of the sprint (default `current`).

### sprint summary

`azdev sprint summary [sprint] [--assignedTo <user>] [--operational <csv>] [--teamId <id>]` — a person's delivery grouped by story.

Output: `sprint`, `assignee`, `totals` (cards, done, product, operational, stories, byType), `stories[]` (`story`, `inSprint` — the person's cards in the sprint, `cycle` — the story's other cards, any assignee and sprint, with `Sprint`), `orphans` (cards with no parent), `operational`. Removed cards are left out. `--assignedTo` defaults to you; `--operational` defaults to `operationalTypes` in flows.json.

### sprint current

`azdev sprint current [--teamId <id>]` — `id`, `name`, `path`, start and finish dates.

### sprint list

`azdev sprint list [--teamId <id>]` — the team's iterations.

### sprint capacity

`azdev sprint capacity [sprint] [--teamId <id>]` — per member: activities (`name`, `capacityPerDay`) and days off; team totals.

`--teamId` everywhere: the team whose `current` sprint (or capacity) to use; default: the project's default team.

---

## flow

Driven by `flows.json` (path: `azdev config paths`). A missing or invalid file exits `2` listing every problem.

### flow status

`azdev flow status <storyId> [--flow <name>]` or `azdev flow status --sprint <sprint> [--mine] [--flow <name>] [--teamId <id>]`

- Per story: `cards[]` (`key`, `type`, `status` done|open|missing|skipped, `ids`, `state`, `assignedTo`), `findings[]`, `others[]` (children that fit no card).
- `--sprint`: one row per story (`missing` keys, number of `findings`) plus the findings list. `--mine` only stories holding one of my cards in that sprint. `--flow` audits every story with that flow; several flows applying to one type is an error asking for it.

### flow apply

`azdev flow apply <storyId> [--flow <name>] [--only <keys>] [--skip <keys>] [--with <keys>] [--sprint <sprint>] [--dryRun]`

- Rows: `key`, `action` (exists | created | would-create | skipped | conflict), `ids`, `type`, `title`, `assignedTo`, `state`, `sprint`; `conflicts[]` explains each conflict.
- `--only` only these keys (optional ones included). `--skip` all but these. `--with` optional cards to create too.
- `--sprint` sprint for every created card, over the card's own and the story's.
- `--dryRun` the plan without creating. An unknown key exits `1` before anything is created.

### flow list

`azdev flow list` — the defined flows and their cards.

---

## board

### board list

`azdev board list [--teamId <id>]` — boards of the team (IDs and names for the other board commands).

### board columns

`azdev board columns <boardId> [--teamId <id>]`

### board items

`azdev board items <boardId> [--teamId <id>]` — cards with id, title, state, type, assignee and board column; capped at 200 with a warning on stderr.

### board move

`azdev board move <cardId> --boardId <id> --columnId <id-or-name> [--teamId <id>]` — sets the board's column field; returns `{ id, board, column }`. A wrong column fails listing the available ones.

### board members

`azdev board members [--teamId <id>]` — `displayName`, `uniqueName` (the email for `--assignedTo`), `isTeamAdmin`.

---

## metadata

### metadata types

`azdev metadata types [--type <name>] [--raw]` — types with their states. `--type` one type (case-insensitive; unknown exits `1` listing the types). `--raw` colors, icons, fields, transitions.

### metadata tags

`azdev metadata tags [--raw]` — existing tag names; reuse them instead of inventing variants.

---

## project

### project list

`azdev project list [--top N] [--skip N] [--state <state>]` — `--state` one of `all`, `wellFormed`, `createPending`, `deleted`, `deleting`, `new`, `unchanged`.

### project get

`azdev project get <projectId> [--capabilities]`

### project create

`azdev project create --name <name> [--description <d>] [--visibility private|public]` — visibility defaults to `private`; anything else exits `1`.

### project areas

`azdev project areas <projectId>` — `{ name, path }`; `path` is ready for `System.AreaPath`.

### project iterations

`azdev project iterations <projectId>` — `{ id, name, path, startDate, finishDate }`; `path` is ready for `System.IterationPath`.

### project create-area

`azdev project create-area --projectId <id> --name <name> [--parentPath <path>]`

### project create-iteration

`azdev project create-iteration --projectId <id> --name <name> [--parentPath <path>] [--startDate <ISO>] [--finishDate <ISO>]`

### project processes

`azdev project processes` — `{ id, name, description, isDefault }`.

### project work-item-types

`azdev project work-item-types <processId>` — types of a process. For the current project's types and states, `azdev metadata types`.

### project work-item-fields

`azdev project work-item-fields --processId <id> --witRefName <ref>` — `{ referenceName, name, type, required }`.

---

## config

### config show

`azdev config show` — the config file with credentials redacted, plus `credentialSource` (`env`, `keychain` or `none`).

### config paths

`azdev config paths` — `config`, `flows`, `conventions`, each with `path` and `exists`.

### config get

`azdev config get <key>` — credential keys print `***`.

### config set

`azdev config set <key> <value>` — `personalAccessToken` and `password` go to the OS keychain; every other key to `config.json` (mode 0600). Keys: `orgUrl`, `project`, `authType` (pat, entra, ntlm, basic), `richTextFormat` (html, markdown), `isOnPremises`, `collection`, `apiVersion`, `username`, `domain`.

### config unset

`azdev config unset <key>` — exits `1` when the key was not set.

---

## Exit codes

`0` success · `1` API error (one stderr line, status code prefix; a 401 adds a credential hint) or an invalid flag/ID · `2` config or flows.json missing/invalid, or no credential found.
