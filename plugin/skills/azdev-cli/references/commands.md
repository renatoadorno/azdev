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

### workitem template

`azdev workitem template [name] [--title <t>] [--parent <id>]` — description templates from the user's `templates/` directory (`azdev config paths`). A template is the **model** to write a card's description from — never the description itself.

- No `name`: lists the templates with their `sections` (headings).
- `name`: prints the template as raw Markdown. `--title` fills `{title}`; `--parent <id>` fills `{parentId}` and `{parentTitle}` (reads the parent). Placeholders not given stay visible.

### workitem children

`azdev workitem children <id> [--recursive] [--mine] [--open] [--state <s>] [--type <t>]` — hydrated rows: id, type, state, title, assignee, parent.

- `--recursive` the whole subtree.
- `--mine` only mine. `--open` exclude Done/Closed/Removed/Completed. `--state` exact state. `--type` exact type.

### workitem progress

`azdev workitem progress <storyId>` — how far a story is, over its whole subtree.

Output: `story` (type, state, title, assignee, `sprint`, `ageDays`, `leadTimeDays` once done, `firstActivity`, `lastDelivery`), `totals` (`items`, `todo`, `doing`, `done`, `donePct`, `removed` — removed items are left out of `items`), `effort` when items carry Effort/Story Points or Remaining Work, `sprints` the children span, `byType` and `byAssignee` (items, todo, doing, done, donePct), `open[]` with `ageDays`, `daysInState`, `daysSinceChange`, longest wait first. Buckets come from each type's state categories, so a custom state (`staging`, `Committed`) lands where the process puts it.

### workitem query

`azdev workitem query [filters] [--where <wiql>] [--fields <csv>] [--orderBy <order>] [--top N] [--count | --groupBy <csv>] [--printWiql]` — a free query, newest change first. Filters combine with AND:

- `--type`, `--state` one value or several, comma-separated. `--open` exclude finished states.
- `--mine`, `--assignedTo <user>` or `--unassigned` (one of them).
- `--sprint <sprint>`, `--area <path>` (subareas included), `--parent <id>` (direct children).
- `--tags a,b` carrying every tag. `--text <t>` in title or description.
- `--createdSince`, `--changedSince`, `--closedSince`: `7d`, `2w`, `3m`, `1y`, `today`, `yesterday` or `YYYY-MM-DD`.
- `--where "<condition>"` any extra WIQL condition, ANDed. Field names in brackets may be short: `[priority] = 1`, `[assignedTo] = @me`, `[Remaining Work] > 4`, `[Custom.Squad] = 'Core'`; quoted text is left alone (`[title] CONTAINS '[PROD]'`). Macros work: `@me`, `@today - 7`.
- `--wiql "<query>"` or `--wiqlFile <file>` a whole WIQL query (starting with `SELECT`), run as given — no filter flags with it. Its `SELECT` columns are returned unless `--fields` says otherwise; `FROM WorkItemLinks` queries return their targets.

Output:
- Rows (default): id, type, state, title, assignee, parent; `--fields` exactly these columns, in that order, empty where an item has no value. `--orderBy "closed desc, id"` (default `changed desc`). `--top N` max rows (default 100, `0` = no limit); hitting it prints a warning.
- `--count` → `{ count }` over every match. `--groupBy state,assignedTo` → `{ total, groups[] }`, one row per combination with its `count`, largest first.
- `--printWiql` → `{ wiql }`, the query the flags build, without running it.

Field names (`--fields`, `--groupBy`, `--orderBy`, `[…]` in `--where`): aliases `id, title, state, reason, type, assignedTo, createdBy, changedBy, tags, parent, area, sprint, created, changed, activated, resolved, closed, stateChange, priority, severity, effort, storyPoints, remaining, originalEstimate, completedWork, description, history, boardColumn, boardLane, commentCount`; else a reference name, a display name (`Remaining Work`) or the last segment of a custom field (`squad` for `Custom.Squad`). Unknown names fail with suggestions; `azdev metadata fields` lists them all. More than 20,000 matches fails asking to narrow the filters.

### workitem mine

`azdev workitem mine [--sprint <sprint>] [--state <s>] [--open] [--top N]` — my items, newest first.

- `--sprint` only that sprint. `--path` full iteration path instead (not both).
- `--state` exact state. `--open` exclude finished states. `--top N` max rows (default 100).

### workitem inbox

`azdev workitem inbox [--since <when>] [--peek]` — what reached me since the last check (cards others changed, cards taken from me, mentions), then moves the last check to now. The last check is kept per project in `inbox.json`, next to `config.json` (`azdev config paths`).

- `--since` look back from `7d`, `2w`, `today`, `yesterday` or `YYYY-MM-DD` instead of the last check. The first check looks back `1d`.
- `--peek` leave the last check where it is.

Output: `since` (start of the window); `assigned[]` — cards assigned to me that someone else changed in the window, read from each card's history, so a later change of mine does not hide theirs: id, type, state, title, `ChangedBy` (everyone else who changed it, latest first), `ChangedDate` (the latest of their changes), `change` (`new` when created in the window, else `changed`), `url`; `removed[]` — cards someone else took from me in the window (reassigned or left with no assignee; not the ones I handed over), from each card's history: id, type, state, title, `AssignedTo` (now; empty when nobody), `RemovedBy`, `RemovedDate` (the latest time it left me), `url`; `mentions[]` — comments made in the window that mention me, not my own, newest first: card `id`, `Title`, `author`, `date`, `text`, `url`. A mention is found by my identity id in the comment, in HTML or Markdown. Mentions are looked up among the cards the `@RecentMentions` WIQL macro returns (last 30 days).

### workitem search

`azdev workitem search <query> [--top N]` — text in title or description, newest first. `--top N` max rows.

### workitem recent

`azdev workitem recent [--top N] [--skip N]` — recently changed items (default `--top 10 --skip 0`).

### workitem list

`azdev workitem list [--query <wiql>]` — raw WIQL, hydrated with the queried columns. Default query: every item of the project, newest first. Prefer `workitem query`, which builds the WIQL from flags and also counts and groups.

### workitem create

`azdev workitem create --type <t> --title <t> [options]` — one request, parent link included.

- `--type`, `--title` required. Unsure of the type name: `azdev metadata types`.
- `--parent <id>` child of this item; area and sprint come from the parent unless given.
- `--tags` separated by `;` or `,`.
- `--sprint <sprint>` or `--iterationPath <path>` (not both). `--areaPath <path>`.
- `--description <text>` or `--descriptionFile <file>` (not both).
- **Template check.** When `templates/<type>.md` exists (or `--template <name>` picks another), the description is required and written from it: a missing description, or the untouched template, fails before anything is sent; a template section left out prints a warning. The confirmation says which `template` was used. `--noTemplate` skips the check.
- `--assignedTo <user>`. `--state` initial state.
- `--format html|markdown` format of the description; default: Markdown when a template applies, else config `richTextFormat`, else HTML.
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

- Create: `{"workItemType":"Task","title":"A","parentId":1200,"tags":"x","sprint":"current","assignedTo":"@me","description":"…","format":"markdown"}`. Each create goes through the same template check as `create`; `"template":"<name>"` picks another, `"noTemplate":true` skips it.
- Update: `{"id":42,"fields":{"System.State":"Done"}}`.
- `--raw` returns `{ count, workItems }` with full objects. For a story's standard cards, prefer `flow apply`.

---

## sprint

### sprint items

`azdev sprint items [sprint] [--mine] [--assignedTo <user>] [--type <t>] [--state <s>] [--open] [--teamId <id>]` — hydrated rows of the sprint (default `current`).

### sprint summary

`azdev sprint summary [sprint] [--assignedTo <user>] [--operational <csv>] [--teamId <id>]` — a person's delivery grouped by story.

Output: `sprint`, `assignee`, `totals` (cards, done, product, operational, stories, byType), `stories[]` (`story`, `inSprint` — the person's cards in the sprint, `cycle` — the story's other cards, any assignee and sprint, with `Sprint`), `orphans` (cards with no parent), `operational`. Removed cards are left out. `--assignedTo` defaults to you; `--operational` defaults to `operationalTypes` in flows.json.

### sprint progress

`azdev sprint progress [sprint] [--mine] [--assignedTo <user>] [--type <csv>] [--product] [--daily] [--teamId <id>]` — how far a sprint is (default `current`).

Output: `sprint` (`startDate`, `finishDate`, `workingDays`, `daysElapsed` — today not counted, `daysLeft`, `timeElapsedPct`, `state` not started|running|finished), `totals` (`items`, `todo`, `doing`, `done`, `donePct`, `removed` apart), `pace` (`expectedDonePct` = time elapsed, `actualDonePct`, `gap`, `status` ahead | on track | behind), `effort` when items carry estimates, `byState` (state, bucket, count), `byType`, `byAssignee`.

- Buckets follow each type's state categories: Proposed → todo, InProgress/Resolved → doing, Completed → done.
- `--daily` adds `daily[]` (`date`, `items`, `done`, `donePct`) at the end of each working day so far — a burn-up that also shows scope added mid-sprint. Two queries per day.
- `--product` leaves out the `operationalTypes` of flows.json. `--type` only these types.

### sprint carryover

`azdev sprint carryover [sprint] [--mine] [--assignedTo <user>] [--type <csv>] [--product] [--open] [--lookback N] [--teamId <id>]` — work pushed from sprint to sprint (default `current`).

- An item is **carried** once for every earlier sprint (the team's, by dates) it was still unfinished in at that sprint's end — read with ASOF queries, so it reflects the board as it was. `--lookback N` earlier sprints to check (default 6). `--open` only items not finished yet.
- flows.json `backlogSprints` (waiting lists such as a parking-lot sprint) are never counted as a sprint an item was carried from. Items fitting a card with `expectedCarryover: true` (a production publication waiting for its deploy window) go to `expected[]` instead of the count.
- Output: `lookedBack`, `totals` (`items`, `carriedIn`, `carriedInPct`, `timesCarried`, `expected`), `byAssignee`, `carriedIn[]` (`carried` count, `from` the sprints, oldest first), `expected[]`.
- A finished sprint adds `carriedOut`: the items unfinished at its end and where each is now — `moved` (to another sprint), `parked` (in a backlog sprint), `expected`, `closed late` (still in the sprint, finished after its end), `still open`, `removed` — with counts per kind.
- Earlier sprints are the team's sprints that started before this one and ended by its first day; overlapping sprints are not earlier. `--lookback` must be at least 1.

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

`azdev flow apply <storyId> [--flow <name>] [--only <keys>] [--skip <keys>] [--with <keys>] [--sprint <sprint>] [--name <feature>] [--titles <json>] [--descriptions <dir>] [--noTemplate] [--dryRun]`

- Rows: `key`, `action` (exists | created | would-create | skipped | conflict), `ids`, `type`, `title`, `assignedTo`, `state`, `sprint`, `template` (the model the card's description follows), `description` (provided | missing | invalid); `conflicts[]` explains each conflict, `warnings[]` lists template sections left out.
- `--descriptions <dir>` one `<key>.md` per card to create, written from that card's template (`template` in the row). The model is the card's inline `description` in flows.json, else `templates/<card template or type>.md`. A missing, untouched or unknown-key description fails before **any** card is created. `--noTemplate` creates without descriptions.
- `--only` only these keys (optional ones included). `--skip` all but these. `--with` optional cards to create too.
- `--sprint` sprint for every created card, over the card's own and the story's.
- `--name "<feature>"` fills `{title}` in the cards' titles (and inline descriptions) with the feature's name instead of the story's title — a feature spanning repositories under a story named otherwise. `{parentTitle}` in templates stays the story's title. The output echoes `name`.
- `--titles '{"pub-prod":"Deploy API + app [PROD]"}'` whole titles by card key (`{title}`/`{id}` allowed). A title must still match its card's `match`, or the row is a `conflict` and the card is not created; an unknown key or an empty title exits before anything is created; a title for a card that already exists or is skipped is not applied and comes back in `warnings`.
- `--dryRun` the plan without creating — run it first to see which templates to write. An unknown key exits `1` before anything is created.

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

### metadata fields

`azdev metadata fields [--search <text>] [--raw]` — the project's fields: `referenceName`, `name`, `type` — the names `workitem query` takes. `--search` keeps fields whose name or reference name contains the text. `--raw` the full field objects.

### metadata tags

`azdev metadata tags [--raw]` — existing tag names; reuse them instead of inventing variants.

---

## stats

Numbers over time. Every stats command takes `--mine`, `--assignedTo <user>`, `--type <csv>`, `--product` (leaves out flows.json `operationalTypes`) and `--teamId <id>` (whose sprints). Done means the Completed state category of each type; removed items never count. Sprint progress and carry-over live under `sprint`, a story's progress under `workitem progress`.

### stats throughput

`azdev stats throughput [--by sprint|week] [--last N] [--mine] [--assignedTo <user>] [--type <csv>] [--product] [--teamId <id>]` — delivered items.

- `--by sprint` (default): the team's last `N` sprints that have started (default 6; flows.json `backlogSprints` left out). Each row: `sprint`, `start`, `finish`, `planned` (items in it at its end), `done` (done at its end), `donePct`, `notDone`, `current` (still running). Read as of each sprint's end, so later moves do not rewrite it.
- `--by week`: items closed per ISO week, the last `N` weeks; the running week is `current`. The close day is ClosedDate, or the last state change for a type that does not set it (same in `cycle-time`).
- `avgDone`, `medianDone` (and `avgDonePct` by sprint) over the finished periods only.

### stats cycle-time

`azdev stats cycle-time [--since <date> | --sprint <sprint>] [--by type|assignedTo|none] [--mine] [--assignedTo <user>] [--type <csv>] [--product] [--teamId <id>]` — how long delivered items took.

- Scope: items closed since `--since` (default `90d`; `3m`, `1y`, `YYYY-MM-DD`), or the done items of `--sprint`.
- `leadTimeDays` (created → closed) and `cycleTimeDays` (activated → closed): `items`, `avg`, `median`, `p85`, `max`.
- `boardHabits`: how far those numbers measure the work rather than the board — `createdNearClose` (created less than an hour before closing: registered after the work), `activatedNearClose` (entered an in-progress state less than an hour before closing), `neverActivated` (no cycle time). A `caveat` appears when at least 20% of the activated items or 10% of all items moved that late; then prefer lead time and pass the caveat on with the numbers.
- `byType` / `byAssignee` (`--by`, default type): `items`, `leadMedian`, `leadP85`, `cycleMedian`, `cycleP85`. `slowest[]` the five longest.

### stats aging

`azdev stats aging [--sprint <sprint>] [--state <csv>] [--inProgress] [--minDays N] [--top N] [--includeParked] [--mine] [--assignedTo <user>] [--type <csv>] [--product] [--teamId <id>]` — open items by how long they have sat in their current state.

- `--inProgress` only items already started (what is stuck rather than waiting to start). `--minDays N` only items at least `N` days in their state. `--top N` items listed (default 20).
- Items in flows.json `backlogSprints` are left out (`parkedLeftOut` counts them) unless `--includeParked`.
- Output: `open`, `inFinishedSprints` (open items sitting in a sprint already over — left behind), `daysInState` summary, `distribution` (`0-7`, `8-14`, `15-30`, `31-90`, `91+` days), `items[]` (`sprint`, `sprintOver`, `ageDays`, `daysInState`, `daysSinceChange`), longest wait first.

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

`azdev config paths` — `config`, `flows`, `conventions`, `templates` (the directory), `inbox` (last check of `workitem inbox`), each with `path` and `exists`.

### config get

`azdev config get <key>` — credential keys print `***`.

### config set

`azdev config set <key> <value>` — `personalAccessToken` and `password` go to the OS keychain; every other key to `config.json` (mode 0600). Keys: `orgUrl`, `project`, `authType` (pat, entra, ntlm, basic), `richTextFormat` (html, markdown), `isOnPremises`, `collection`, `apiVersion`, `username`, `domain`.

### config unset

`azdev config unset <key>` — exits `1` when the key was not set.

---

## Exit codes

`0` success · `1` API error (one stderr line, status code prefix; a 401 adds a credential hint) or an invalid flag/ID · `2` config or flows.json missing/invalid, or no credential found.
