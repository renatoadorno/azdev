interface CliError {
  statusCode?: number;
  message?: string;
}

export function exitWithError(err: unknown, code = 1): never {
  const e = err as CliError;
  const message = e?.message ?? String(err);
  console.error(e?.statusCode ? `${e.statusCode}: ${message}` : message);
  if (e?.statusCode === 401) {
    console.error('Authentication failed — check personalAccessToken in ~/.config/azdev/config.json (azdev config show).');
  }
  process.exit(code);
}
