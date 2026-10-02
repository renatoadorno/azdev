import type { AzureDevOpsConfig } from '../interfaces/AzureDevOps';
import { loadCliConfig } from './config';
import { exitWithError } from './errors';
import { format } from './formatters/index';

/** Flags every service-backed subcommand accepts. */
export const globalOptions = {
  json: { type: 'boolean' as const, description: 'Output as JSON' },
  markdown: { type: 'boolean' as const, description: 'Output as Markdown' },
  project: { type: 'string' as const, description: 'Override project from config' },
};

export interface OutputArgs {
  json?: boolean;
  markdown?: boolean;
  project?: string;
}

type ServiceClass<S> = new (config: AzureDevOpsConfig) => S;

/** Routes any failure through the single error channel. */
export async function runCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    exitWithError(err);
  }
}

/**
 * The body every service-backed subcommand shares: load the config, apply
 * --project, run the call, print it in the requested format, and route any
 * failure through the single error channel.
 */
export async function runService<S>(
  Service: ServiceClass<S>,
  args: OutputArgs,
  call: (service: S) => Promise<unknown>,
  options: { plainText?: boolean } = {},
): Promise<void> {
  await runCommand(async () => {
    const config = await loadCliConfig();
    if (args.project) config.project = args.project;

    const result = await call(new Service(config));
    // Markdown meant to be read as-is (a template) skips the toon/JSON encoding.
    console.log(options.plainText && typeof result === 'string' ? result : format(result, args));
  });
}
