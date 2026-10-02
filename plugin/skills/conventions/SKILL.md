---
name: conventions
description: "Team conventions for Azure DevOps cards — the per-user conventions.md, flows.json and description templates that azdev reads. Use when conventions.md is missing before writing to or auditing the board, or flows.json is missing or invalid before running `azdev flow`; when the user asks what the team's rules are, to set up the story flow, or to add or change a description template for a card type; when the user states a new team rule (state names, backlog sprint, title markers, who a card is assigned to, who reviews, tests or publishes)."
---

# Team conventions for azdev

Three per-user sources hold what a generic CLI cannot know about a team. All live next to `config.json`; get their paths with `azdev config paths`.

- **`conventions.md`** — prose read by the agent: rules, roles and traps that change how a card is created, named, assigned or closed. Free Markdown, in the user's language.
- **`flows.json`** — machine-read by `azdev flow` and `azdev sprint summary`: the cards a story must have and the operational types.
- **`templates/`** — one `<name>.md` per card type (`Publication.md`, `technical tests.md`) or variant (`Publication [PROD].md`): the **model** each description is written from. `azdev workitem create` and `azdev flow apply` refuse a card of that type without a description written from it, or with the template untouched.

Keep each fact in one place. A rule the CLI enforces (a card that must exist, a title pattern, a required description) goes in `flows.json`; the shape of a description goes in its template; everything else goes in `conventions.md`.

## Reading

1. Run `azdev config paths`.
2. If `conventions.exists`, Read the file and apply it for the rest of the task. It overrides generic advice from the azdev-cli skill.
3. If `flows.exists`, check it with `azdev flow list`; a broken file exits `2` listing every problem.

## Creating conventions.md

Create it when it is missing and the task writes to or audits the board, or when the user asks. Discover first, then ask only what the board cannot tell. If `azdev config show` exits `2` or shows `credentialSource: none`, run the **setup** skill first.

1. **Discover** with read-only commands — done when every section of the template has either a discovered fact or a question for step 2:
   - `azdev config show` — org and project.
   - `azdev metadata types` — custom types and their states. Note every type without `Removed`, and every type whose finished state is not `Done`, `Closed` or `Completed` — the CLI treats only those (and `Removed`) as finished, so `--open` and `flow status` count such cards as open.
   - `azdev sprint list` and `azdev sprint current` — naming pattern and current sprint. A far-future sprint holding many open items is likely the backlog; confirm before writing it down.
   - `azdev sprint items <recent sprint> --type <publication-like type>` — title markers in use (`[PROD]`, `[HOMOLOG]`, "Deploy …").
   - `azdev board members` — names and emails for the roles section.
   - `azdev sprint summary <recent sprint>` — which card types sit with other people in a story's cycle.
2. **Ask** the user, in one short batch, what discovery leaves open: who reviews, tests and publishes; how to discard a card whose type has no `Removed`; which rules weigh on performance metrics; writing rules (Markdown, mentions).
3. **Write** the file at `conventions.path`, starting from `assets/conventions.template.md`. Keep the headings, drop sections with nothing to say, write in the user's language, and state facts with their consequence ("X has no Removed — close with Done and a comment saying why").
4. Show the user what was written and where.

## Creating flows.json

Create it when it is missing and the user wants `azdev flow`, or asks to set up the story flow.

1. Start from `assets/flows.example.json`.
2. Adjust every field from discovery:
   - `parentTypes` → the project's story types; each card `type` → a real type name; `state` → one of that type's states (`azdev metadata types --type <type>`; `To Do` exists only in some processes).
   - `assignedTo` → real emails (`azdev board members`); `operationalTypes` → real types, or drop it.
   - `match` → the title markers seen on the board, covering every variant the team uses for the same card (`\[\s*PROD\s*\]|deploy\s+produ`, written `\\[\\s*PROD\\s*\\]|deploy\\s+produ` inside JSON) — a variant left out makes `flow apply` duplicate cards titled that way.
   - `retestAfter` → only the types of fix cards. A type that the flow's own review or publication cards also use flags the tests as stale every time one of them closes.
   - Children are matched to cards in file order, and a card without `match` takes every remaining child of its type — list it after the other cards of that type.
3. Write it at `flows.path`, then run `azdev flow list` — a file that does not validate exits `2` listing every problem.
4. Preview on a real story with `azdev flow status <storyId>` and `azdev flow apply <storyId> --dryRun`. The dry run does not check types, states or assignees against Azure DevOps — a wrong one fails only on the real `apply` — so verify them in step 2. Setup ends at the dry run; the first real `apply` is the user's call.

## Creating or changing a template

Create one when the user asks for a standard description for a card type, or when the same structure keeps being written by hand.

1. Base it on real cards of that type: `azdev sprint items <sprint> --type <type>`, then `azdev workitem view <id>` on two or three well-written ones. Keep the sections they share.
2. Write it at `<templates.path>/<type>.md` — the file name is the type exactly as `azdev metadata types` lists it, or a variant name (`Publication [PROD]`) that a flow card selects with `"template"` or a create with `--template`.
3. Use `##` headings for the sections — `create` warns when a description leaves one out, so make every heading a section that most cards of the type need. Under each heading, write the prompt for the content in angle brackets (`<PR URL per repository>`, `<what was tested and how>`), so an untouched template is easy to spot and the writer knows what goes there. Placeholders `{title}`, `{parentId}` and `{parentTitle}` are filled for the card being written.
4. Check it with `azdev workitem template <name> --title "Sample" --parent <story id>`.

A template is a model, never content: every card written from it carries the task's own facts.

## Updating

When the user states a new rule, or a command reveals one (a state that does not exist, a title convention), propose the exact line to add, and edit the file after the user agrees. Edit in place, touching only that line or section. After editing `flows.json`, run `azdev flow list` — an invalid file makes `azdev flow` and `azdev sprint summary` exit `2`.

## Rules

- These files are personal and may name colleagues and internal URLs: they live only in the config directory, outside every repository, plugin and public document.
- Credentials stay in the OS keychain, never in either file.

## Additional resources

- **`assets/conventions.template.md`** — section layout for `conventions.md`.
- **`assets/flows.example.json`** — a generic story flow to adapt.
- **`assets/description.template.example.md`** — the shape of a description template.
