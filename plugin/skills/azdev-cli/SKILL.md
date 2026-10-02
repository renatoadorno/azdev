---
name: azdev-cli
description: "Azure DevOps work items through the azdev CLI. Use when the user refers to an Azure DevOps card, task, bug or story — a dev.azure.com or visualstudio.com link, or a #1234 id in a project tracked in Azure DevOps (not a GitHub issue or PR) — to read its spec, comments, images or history; list my work or a sprint; create, update, comment on, assign or close cards; create a story's standard cards or check a story or sprint for missing ones; analyze someone's delivery by story."
---

# azdev CLI

`azdev` is the Azure DevOps CLI on this machine — 48 subcommands across 7 groups (workitem, sprint, board, project, metadata, flow, config). Output defaults to toon, compact and made for agents; keep it unless the user wants `--json` or `--markdown`. `--project <name>` targets another project. Flags are camelCase: `--assignedTo`, `--descriptionFile`, `--dryRun`.

## Preflight

Run once per session, before the first command of the task.

1. `azdev config show`. Done when it prints `orgUrl`, `project` and a `credentialSource` of `keychain` or `env` — with `authType: entra` there is no `credentialSource`, and that is fine. Otherwise (`command not found`, exit `2`, no `orgUrl` or `project`, or `credentialSource: none`) hand over to the **setup** skill (`/azdev:setup`).
2. `azdev config paths`. If it fails as an unknown command, the binary is older than this plugin — hand over to the **setup** skill. When `conventions.exists` is true, Read that file — done when read. Its rules (state names, how to discard a card, backlog sprint, title markers, who reviews and publishes) override every generic default in this skill.
3. When `conventions.exists` is false and the task writes to the board or audits it, hand over to the **conventions** skill first. Read-only questions go ahead without it. `templates.exists` tells whether description templates are set up.

## Pick the command

One call answers each of these — reach for it before composing WIQL or chaining commands.

**Read a card**
- Whole context (fields, description as text, parent, children, links, PRs, latest comments, image URLs) → `azdev workitem view <id>`
- Comments only → `azdev workitem comments <id>`
- Images and files → `azdev workitem attachments <id> --download "$(mktemp -d)"`, then Read each returned `path` (a temporary directory keeps attachments out of the repository)
- What changed, by whom, when → `azdev workitem history <id>`
- Children → `azdev workitem children <id> [--recursive] [--open] [--type <t>]`

**List work**
- Mine, open, this sprint → `azdev sprint items --mine --open` (any sprint: `azdev sprint items 82 --mine`)
- A sprint by type, state or person → `azdev sprint items <sprint> --type <t> | --state <s> | --assignedTo <user>`
- Mine across sprints → `azdev workitem mine --open`
- Text search → `azdev workitem search "<text>"`

**Write**
- The model for a card's description → `azdev workitem template <type> --title <t> --parent <id>` (no name lists them)
- New card under a story → `azdev workitem create --type <t> --title <t> --parent <id> --descriptionFile <file> [--assignedTo @me] [--tags "a;b"] [--sprint <s>]`
- Change fields → `azdev workitem update <id> --title <t> | --descriptionFile <file> | --sprint <s> | --fields '<json>'`
- Comment → `azdev workitem comment <id> --file <file>`
- State → `azdev workitem set-state <id> --state <s> [--comment <t>]`
- Owner → `azdev workitem assign <id> --to <user>`

**Story cycle**
- Is the story complete? → `azdev flow status <storyId>`
- Which of my stories miss cards? → `azdev flow status --sprint current --mine`
- Create the missing cards → `azdev flow apply <storyId> --dryRun` (each row names the `template` its description follows); write one `<key>.md` per card in a temporary directory; show the plan and the descriptions, wait for the user's go-ahead, then `azdev flow apply <storyId> --descriptions <dir>`

**Analyze**
- Someone's delivery in a sprint → `azdev sprint summary <sprint> [--assignedTo <user>]` — grouped by story, with the rest of each story's cycle and operational work apart. Counting cards per assignee misreads delivery.
- Valid states of a type → `azdev metadata types --type <name>`. Existing tags → `azdev metadata tags`. Emails → `azdev board members`.

Values: a sprint is `current`, `82`, `Sprint 82`, a path or a GUID; a user is an email, a display name or `@me`.

**Every subcommand and flag, with output shapes: [`references/commands.md`](references/commands.md).** Read it before using a command or flag not shown above; `azdev <group> <sub> --help` lists the same flags.

## Writing to the board

The board is shared and read by people. Make every write land right the first time.

- **One request per card.** `create --parent` sends parent, tags and sprint together; area and sprint come from the parent unless given. Check an unsure request with `--dryRun`.
- **Templates are models, the content is the task's.** When `templates/` has one for the card's type (`azdev workitem template`), read it, then write the description with this task's own facts — PRs, steps, scenarios, results — under the template's sections, leaving out a section only when it does not apply. `create` and `flow apply` refuse a missing description or the untouched template and warn on a section left out; `--template <name>` picks another model (`Publication [PROD]`), `--noTemplate` skips it.
- **Long text through a file.** Write the description or comment to a file and pass `--descriptionFile` or `comment --file`; shell-quoted JSON breaks on quotes and newlines.
- **Markdown.** Rich text is HTML unless `--format markdown` or config `richTextFormat=markdown`. Markdown keeps line breaks and lists; on `update` the format only sticks when the content changes in the same call.
- **`#<number>` links a work item.** Write `#1234` for work items only; reference a PR or any other id by its full URL.
- **Mentions** in a Markdown comment: `@<identity-id>`, the `id` of an identity field from `azdev workitem get <id> --raw`.
- **States differ per type.** A wrong state fails listing the valid ones; some types have no `Removed` — the conventions file says how the team discards those.
- **Tags:** reuse names from `azdev metadata tags`.
- **Evidence stays dated.** To complete or correct an old card that already has content (a retest, a reply to a report), add a comment rather than rewriting its description. An empty description that `flow status` flags is filled with `update --descriptionFile`.
- Writes print a compact confirmation with the browser `url` — give that link to the user.

## Reading

- `view` decodes descriptions: the storage keeps `&gt;`, `&quot;` even in Markdown fields, so compare text only after decoding.
- Attachments need the configured credential; `attachments --download` uses it from the keychain, so the token never has to be read or printed.

## Story flows

`flows.json` (next to `config.json`; `azdev config paths`) lists the child cards each story type must have. The **conventions** skill creates it when missing.

- `flow status` marks each card `done`, `open`, `missing` or `skipped` and lists `findings`: a missing card (naming a same-type child whose title misses the expected marker), a card whose description is empty or still the template, tests closed before a later fix with no retest recorded since.
- `flow apply` is idempotent: existing cards come back `exists` and are never duplicated, so re-run it after a failure. Optional cards need `--with <key>`. A `conflict` row means the story's own title would make the new card count as another one — report it to the user.
- Clear a finding by its kind:
  - missing card → `flow apply`; but when the finding names a same-type child with the wrong title, rename that child (`workitem update <id> --title`) — a new card would duplicate it;
  - empty or template description → fill it with `workitem update <id> --descriptionFile <file>` (a comment does not clear it);
  - tests closed before a later fix → a retest comment on the tests card (`comment --file`) or a new tests card.

## Limits

Pull requests, repositories and pipelines are outside the CLI — use the web UI. Exit codes: `0` ok · `1` API error or invalid flag/ID (one stderr line; 401 means the credential) · `2` config or credential missing (→ **setup**) or flows.json missing or invalid (→ **conventions**).
