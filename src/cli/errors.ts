/** What to do after a 401 — printed by the CLI and sent by the daemon. */
export const AUTH_FAILED_HINT = [
  "Authentication failed — check the credential source with 'azdev config show'.",
  "Store a new token with 'azdev config set personalAccessToken <token>', or set AZDEV_PAT.",
];

interface CliError {
  statusCode?: number;
  message?: string;
}

export function exitWithError(err: unknown, code = 1): never {
  const e = err as CliError;
  const message = e?.message ?? String(err);
  console.error(e?.statusCode ? `${e.statusCode}: ${message}` : message);
  if (e?.statusCode === 401) {
    for (const line of AUTH_FAILED_HINT) console.error(line);
  }
  process.exit(code);
}
