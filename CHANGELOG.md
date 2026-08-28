# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[unreleased]: https://github.com/renatoadorno/azdev/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/renatoadorno/azdev/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/renatoadorno/azdev/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/renatoadorno/azdev/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/renatoadorno/azdev/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/renatoadorno/azdev/releases/tag/v0.1.0
