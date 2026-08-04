import { defineCommand } from 'citty';
import { MetadataService } from '../../services/MetadataService';
import { loadCliConfig } from '../config';
import { exitWithError } from '../errors';
import { format } from '../formatters/index';

const globalOptions = {
  json: { type: 'boolean' as const, description: 'Output as JSON' },
  markdown: { type: 'boolean' as const, description: 'Output as Markdown' },
  project: { type: 'string' as const, description: 'Override project from config' },
};

function getService(options: { project?: string }) {
  const config = loadCliConfig();
  if (options.project) config.project = options.project;
  return new MetadataService(config);
}

function slimType(t: any) {
  return {
    name: t.name,
    referenceName: t.referenceName,
    description: t.description,
    states: (t.states ?? []).map((s: any) => s.name),
  };
}

const types = defineCommand({
  meta: { name: 'types', description: 'List work item types available in the project' },
  args: {
    ...globalOptions,
    raw: { type: 'boolean', description: 'Return the full raw types (color, icon, fields, transitions)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getWorkItemTypes();
      const view = args.raw ? result : result.map(slimType);
      console.log(format(view, args));
    } catch (err) {
      exitWithError(err);
    }
  },
});

const tags = defineCommand({
  meta: { name: 'tags', description: 'List tags defined in the project' },
  args: {
    ...globalOptions,
    raw: { type: 'boolean', description: 'Return the full raw tags (id, lastUpdated, url)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getTags();
      const view = args.raw ? result : result.map((t: any) => ({ name: t.name }));
      console.log(format(view, args));
    } catch (err) {
      exitWithError(err);
    }
  },
});

export default defineCommand({
  meta: { name: 'metadata', description: 'Project metadata commands (work item types, tags)' },
  subCommands: {
    types,
    tags,
  },
});
