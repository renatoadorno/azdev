# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-10-02

A free query, progress and delivery numbers, and card titles of a flow set per
feature.

### Added

- `workitem query`: filter flags (`--type`/`--state` lists, `--sprint`, `--area`,
  `--tags`, `--text`, `--parent`, `--unassigned`, `--createdSince`/`--changedSince`/
  `--closedSince` with `7d`, `2w`, `3m` or a date), a free `--where` condition with
  short field names (`[priority] = 1`), a whole `--wiql` query, `--fields`,
  `--orderBy`, `--count`, `--groupBy` and `--printWiql`.
- `metadata fields [--search]`: the project's fields with their reference names.
- `sprint progress`: to do / doing / done by state category, % done against time
  elapsed (`pace`), by state, type and assignee, effort when estimated; `--daily`
  adds a burn-up.
- `sprint carryover`: items still unfinished at the end of earlier sprints (read
  with WIQL ASOF), and where a finished sprint's unfinished items went.
- `workitem progress <storyId>`: a story's whole subtree by type and assignee, the
  sprints it spans and what is still open, for how long.
- `stats throughput` (per sprint, as of its end, or per week), `stats cycle-time`
  (lead and cycle time: average, median, p85, with `boardHabits` and a `caveat` when
  cards were created or moved to in progress right before closing) and `stats aging`
  (open items by time in their state, left-behind items in finished sprints flagged).
- Every stats command takes `--mine`, `--assignedTo`, `--type` and `--product`
  (leaves out flows.json `operationalTypes`).
- flows.json `backlogSprints` (waiting-list sprints) and card `expectedCarryover`
  (a card that changes sprints by design) keep process moves out of carry-over.
- `flow apply --name <feature>` fills `{title}` in the cards' titles with the
  feature's name; `--titles '{"<key>":"<title>"}'` sets whole titles per card.

## [0.5.3] - 2026-10-02

Description templates per work item type, used as models: a card carries its
task's own content, written in the template's structure.

### Added

- `templates/` next to `config.json`: one `<name>.md` per work item type (or a
  variant such as `Publication [PROD].md`), the model each description is written
  from. `azdev workitem template [name] [--title] [--parent]` lists them or prints
  one with `{title}`, `{parentId}` and `{parentTitle}` filled.
- `workitem create` and `bulk-create` check the description against the type's
  template (or the one `--template` names): a missing description, the untouched
  template or a leftover `<…>` prompt fails before anything is sent, and a template
  section left out prints a warning. `--noTemplate` skips the check.
- `flow apply --descriptions <dir>` takes one `<key>.md` per card to create. A
  missing, untouched or unknown-key description fails before any card is created;
  the dry run shows the `template` each card follows and whether its `description`
  is there. Flow cards pick a template with `"template"`.
- `config paths` reports the `templates` directory.

### Changed

- A flow card's inline `description` is a model to write from, no longer the text
  `flow apply` writes; `flow status` recognizes an untouched template file as an
  empty description.

### Fixed

- `install.sh` (and `scripts/install-dev.sh`) re-sign the binary ad-hoc on macOS when
  its signature does not verify — macOS kills such a binary with exit 137 and no
  output — and check that the installed binary runs.

## [0.5.2] - 2026-10-02

Creating a story's cards and reading what happened to them stop taking several
round trips.

### Added

- `workitem create` takes `--parent`, `--tags` and `--sprint` and sends them in the
  same request — one call instead of create + update tags + link parent. With
  `--parent`, area and sprint are inherited from the parent unless given.
  `--descriptionFile` reads the description from a file (or stdin), and `--dryRun`
  prints the resolved request without creating.
- `--sprint` (on `create`, `update`, `mine`) and the positional of `sprint items`,
  `sprint summary` and `sprint capacity` accept `current`, a bare number (`82`), a
  name, a path or a GUID.
- `@me` in `--assignedTo` / `--to` / flows resolves to the authenticated account.
- `workitem view <id>`: fields, description and acceptance criteria as text,
  parent, children, links, PR/branch artifacts, latest comments and image URLs in
  one call.
- `workitem comments <id>`: the comments as plain text, oldest first.
- `workitem attachments <id> [--download <dir>]`: attached files and inline images,
  downloaded with the configured credential — the token no longer has to be read out
  of the keychain to fetch an image.
- `workitem comment --file` and `--format markdown`, which keeps line breaks and
  `#id` links (the SDK only posts HTML, where `\n` collapses into spaces).
- `workitem update --title / --descriptionFile / --sprint`; `--fields` is optional.
- `sprint summary [sprint]`: a person's delivery grouped by story, with the rest of
  each story's cycle (review, QA, publication by others), operational work apart and
  cards with no parent listed.
- `flow list / status / apply`, driven by `flows.json` next to `config.json`: a flow
  lists the cards a story should have. `apply` creates the missing ones as children
  (idempotent, `--dryRun`, `--only/--skip/--with`); `status` audits a story — or
  every story of a sprint — for missing cards, a tests card with no description, tests
  closed before a later fix with no retest, and publications whose title misses the
  expected marker.
- `metadata types --type <name>` to check one type's states.
- `config paths`: where `config.json`, `flows.json` and `conventions.md` live and
  whether each exists.
- Claude Code plugin `azdev`, served by the repository as a marketplace
  (`/plugin marketplace add renatoadorno/azdev`). It ships three skills: `azdev-cli`
  (which command answers which question, how to write to the board), `conventions`
  (reads or creates the per-user `conventions.md` and `flows.json`) and `setup`
  (installs the matching binary and configures org, project and token). Only
  `plugin/` is installed, and its version follows the CLI's.
- Config key `richTextFormat` (`html` | `markdown`): default `--format` for
  descriptions and comments.

### Changed

- `sprint items` returns hydrated rows (id, type, state, title, assignee, parent) and
  takes `--mine`, `--assignedTo`, `--type`, `--state`, `--open`; the sprint defaults to
  `current`. It used to return the raw relation list.
- `workitem history` returns a field-change timeline (`rev`, `date`, `by`,
  `changes`, `comment`); `--raw` keeps the revisions.
- Writes (`create`, `update`, `set-state`, `assign`, `link`, `bulk-create`) print a
  compact confirmation with the browser URL; `--raw` returns the full work item.
  `bulk-create --raw` keeps the former `{ count, workItems }` shape.
- An invalid state on `set-state`, `update` or `create` fails with the valid states
  of the item's type instead of the API's generic rule error.
- `project iterations` rows carry the iteration `id`.

### Fixed

- The README's pinned-version install line set `AZDEV_VERSION` for `curl` instead of
  `bash`, so the version was ignored and the latest release installed.

## [0.5.1] - 2026-08-28

### Changed

- Upgraded `azure-devops-node-api` to 16.0.0. No change was needed on the CLI side.

### Fixed

- Suppressed the `DEP0169` deprecation warning that every API-backed command printed
  to stderr. The SDK still calls the legacy `url.parse()` in `VsoClient.js` and
  `WebApi.js` — unchanged through v17 — so the notice is filtered by code. Every other
  warning still gets through, and stderr is now empty on success.

## [0.5.0] - 2026-08-28

Credentials move out of the config file and into the OS keychain.

### Added

- Credentials are stored in the OS credential store via `Bun.secrets` — Keychain on
  macOS, libsecret on Linux, Credential Manager on Windows. Entries live under the
  service `com.azdev.cli`, scoped per organization, so several orgs can coexist.
- `AZDEV_PAT` and `AZDEV_PASSWORD` override the keychain, for CI, containers, and
  Linux hosts without a secret service.
- `AZDEV_CONFIG_PATH` and `XDG_CONFIG_HOME` override the config file location.
- `azdev config unset <key>` removes a config value, or deletes a stored credential.
- `azdev config show` reports `credentialSource` (`env`, `keychain` or `none`), so it
  stays useful for diagnosing a 401 without printing anything secret.
- First automated test suite (`bun test`), covering the config and credential layer,
  with an opt-in run against the real keychain via `AZDEV_TEST_KEYCHAIN=1`.

### Changed

- `personalAccessToken` and `password` are no longer read from or written to
  `config.json`. Resolution order is environment variable, then keychain, then exit 2
  — there is no fallback to the file.
- A `config.json` still holding a credential in plain text is migrated to the keychain
  on the next command. The key is only dropped from disk after the keychain write
  succeeds, so a failing keychain cannot destroy the only copy of the token.
- The config file is written with mode `0600` and its directory with `0700`; a
  pre-existing world-readable file is tightened on the next write, and reported on
  every read until then.
- Binaries are built with `--minify --bytecode`, and carry the version from
  `package.json` through `--define BUILD_VERSION` instead of shipping `package.json`.
- The release workflow runs typecheck and tests before building.

### Fixed

- `build.js` exited 0 when a target failed, which would let a release publish a
  missing or stale binary. A failing target now fails the build.
- A malformed `config.json` reported "Config file not found", the same message as a
  missing one. The two causes are now distinguished.
- `authType: entra` no longer reads or requires a PAT.

### Security

- The PAT is no longer stored in plain text. It previously lived in
  `~/.config/azdev/config.json`, written world-readable (`0644`).
- `azdev config show` and `azdev config get` redact `personalAccessToken` and
  `password`. Previously `config show` printed the whole file, and it was the command
  suggested by the 401 error hint and by the getting-started guide.

> **Upgrading:** no action required — the migration runs on the first command and
> reports what it did. Rotate your PAT afterwards: it was readable on disk.

## [0.4.0] - 2026-08-04

### Added

- `metadata` command group, with `types` and `tags`.

### Changed

- Board, project and sprint commands call the real API; the remaining mocks and
  no-ops were replaced.

### Fixed

- Work item IDs and `--format` values are validated, WIQL input is escaped, and all
  errors go through a single channel.
- `EntraAuthHandler` is instantiated when `authType` is `entra`.

## [0.3.0] - 2026-06-15

### Added

- `azdev --version`.
- `create --format markdown`.

### Changed

- CI actions run on Node 24.

## [0.2.0] - 2026-06-15

### Added

- `workitem children`.
- `--fields` and `--raw` on `workitem get`.
- Automated release workflow.

### Changed

- Queries hydrate their results — WIQL only returns IDs, so `list`, `mine`, `search`,
  `recent` and `children` batch-fetch the fields.
- `workitem get` returns a slim view by default.

## [0.1.0] - 2026-03-21

### Added

- Initial CLI with the `workitem`, `sprint`, `board`, `project` and `config` command
  groups, in toon output by default with `--json` and `--markdown`.
- Standalone binaries for darwin-arm64 and linux-x64.

[unreleased]: https://github.com/renatoadorno/azdev/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/renatoadorno/azdev/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/renatoadorno/azdev/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/renatoadorno/azdev/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/renatoadorno/azdev/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/renatoadorno/azdev/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/renatoadorno/azdev/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/renatoadorno/azdev/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/renatoadorno/azdev/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/renatoadorno/azdev/releases/tag/v0.1.0
