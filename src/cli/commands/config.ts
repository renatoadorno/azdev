import { defineCommand } from 'citty';
import * as fs from 'fs';
import { CONFIG_PATH, loadCliConfig, writeCliConfig } from '../config';
import { format } from '../formatters/index';

const globalOptions = {
  json: { type: 'boolean' as const, description: 'Output as JSON' },
  markdown: { type: 'boolean' as const, description: 'Output as Markdown' },
};

const show = defineCommand({
  meta: { name: 'show', description: 'Show current config file contents' },
  args: { ...globalOptions },
  async run({ args }) {
    try {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const data = JSON.parse(content);
      console.log(format(data, args));
    } catch {
      console.error(`No config file found at ${CONFIG_PATH}.`);
      console.error("Run 'azdev config set orgUrl ...' to configure.");
      process.exit(2);
    }
  },
});

const set = defineCommand({
  meta: { name: 'set', description: 'Set a config value' },
  args: {
    key: { type: 'positional', description: 'Config key', required: true },
    value: { type: 'positional', description: 'Config value', required: true },
  },
  async run({ args }) {
    try {
      writeCliConfig(args.key!, args.value!);
      console.log(`Set ${args.key}`);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const get = defineCommand({
  meta: { name: 'get', description: 'Get a config value' },
  args: {
    ...globalOptions,
    key: { type: 'positional', description: 'Config key', required: true },
  },
  async run({ args }) {
    try {
      const config = loadCliConfig();
      const value = (config as any)[args.key!];
      if (value === undefined) {
        console.error(`Key '${args.key}' not found in config.`);
        process.exit(1);
      }
      console.log(format(value, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

export default defineCommand({
  meta: { name: 'config', description: 'Configuration commands' },
  subCommands: { show, set, get },
});
