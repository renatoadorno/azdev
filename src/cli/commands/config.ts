import { defineCommand } from 'citty';
import { globalOptions, runCommand } from '../command';
import { configFiles, loadCliConfig, requireConfigFile, unsetCliConfig, writeCliConfig } from '../config';
import { format } from '../formatters/index';
import { isSecretKey, redactSecrets, resolveSecret } from '../secrets';

const outputOptions = { json: globalOptions.json, markdown: globalOptions.markdown };

const keyArg = { type: 'positional' as const, description: 'Config key', required: true };

const show = defineCommand({
  meta: { name: 'show', description: 'Show current config (credentials are never printed)' },
  args: { ...outputOptions },
  async run({ args }) {
    await runCommand(async () => {
      const raw = requireConfigFile();
      const data = redactSecrets(raw) as Record<string, unknown>;
      const authType = raw.authType ?? 'pat';

      if (raw.orgUrl && authType !== 'entra') {
        const kind = authType === 'ntlm' || authType === 'basic' ? 'password' : 'pat';
        data.credentialSource = (await resolveSecret(kind, raw.orgUrl)).source;
      }

      console.log(format(data, args));
    });
  },
});

const set = defineCommand({
  meta: { name: 'set', description: 'Set a config value (credentials go to the OS keychain)' },
  args: {
    key: keyArg,
    value: { type: 'positional', description: 'Config value', required: true },
  },
  async run({ args }) {
    await runCommand(async () => {
      await writeCliConfig(args.key!, args.value!);
      console.log(isSecretKey(args.key!) ? `Stored ${args.key} in the OS keychain` : `Set ${args.key}`);
    });
  },
});

const get = defineCommand({
  meta: { name: 'get', description: 'Get a config value' },
  args: { ...outputOptions, key: keyArg },
  async run({ args }) {
    await runCommand(async () => {
      const config = await loadCliConfig();
      const value = (config as any)[args.key!];

      if (value === undefined) {
        console.error(`Key '${args.key}' not found in config.`);
        process.exit(1);
      }

      console.log(format(isSecretKey(args.key!) ? '***' : value, args));
    });
  },
});

const paths = defineCommand({
  meta: { name: 'paths', description: 'Show where config.json, flows.json and conventions.md live, and whether each exists' },
  args: { ...outputOptions },
  async run({ args }) {
    await runCommand(async () => {
      console.log(format(configFiles(), args));
    });
  },
});

const unset = defineCommand({
  meta: { name: 'unset', description: 'Remove a config value or a stored credential' },
  args: { key: keyArg },
  async run({ args }) {
    await runCommand(async () => {
      if (!(await unsetCliConfig(args.key!))) {
        console.error(`Key '${args.key}' was not set.`);
        process.exit(1);
      }
      console.log(`Unset ${args.key}`);
    });
  },
});

export default defineCommand({
  meta: { name: 'config', description: 'Configuration commands' },
  subCommands: { show, set, get, unset, paths },
});
