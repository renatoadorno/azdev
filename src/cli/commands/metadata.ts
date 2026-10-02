import { defineCommand } from 'citty';
import { MetadataService } from '../../services/MetadataService';
import { globalOptions, runService } from '../command';

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
    type: { type: 'string', description: 'Only this type (case-insensitive), e.g. Issue — to check its states' },
    raw: { type: 'boolean', description: 'Return the full raw types (color, icon, fields, transitions)' },
  },
  async run({ args }) {
    await runService(MetadataService, args, async (svc) => {
      const all = await svc.getWorkItemTypes();
      const wanted = args.type?.toLowerCase();
      const result = wanted ? all.filter(t => t.name?.toLowerCase() === wanted) : all;
      if (wanted && result.length === 0) {
        throw new Error(`Type "${args.type}" not found. Types: ${all.map(t => t.name).join(', ')}`);
      }
      return args.raw ? result : result.map(slimType);
    });
  },
});

const tags = defineCommand({
  meta: { name: 'tags', description: 'List tags defined in the project' },
  args: {
    ...globalOptions,
    raw: { type: 'boolean', description: 'Return the full raw tags (id, lastUpdated, url)' },
  },
  async run({ args }) {
    await runService(MetadataService, args, async (svc) => {
      const result = await svc.getTags();
      return args.raw ? result : result.map((t: any) => ({ name: t.name }));
    });
  },
});

export default defineCommand({
  meta: { name: 'metadata', description: 'Project metadata commands (work item types, tags)' },
  subCommands: {
    types,
    tags,
  },
});
