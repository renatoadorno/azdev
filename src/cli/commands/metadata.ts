import { defineCommand } from 'citty';
import { FieldType } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
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

const fields = defineCommand({
  meta: { name: 'fields', description: 'List the fields of the project — the names --fields, --where and --groupBy take' },
  args: {
    ...globalOptions,
    search: { type: 'string', description: 'Only fields whose name or reference name contains this text' },
    raw: { type: 'boolean', description: 'Return the full raw fields' },
  },
  async run({ args }) {
    await runService(MetadataService, args, async (svc) => {
      const all = await svc.getFields();
      const wanted = args.search?.toLowerCase();
      const result = wanted
        ? all.filter(f => `${f.name} ${f.referenceName}`.toLowerCase().includes(wanted))
        : all;
      if (args.raw) return result;
      return result.map(f => ({ referenceName: f.referenceName, name: f.name, type: FieldType[f.type] ?? f.type }));
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
  meta: { name: 'metadata', description: 'Project metadata commands (work item types, fields, tags)' },
  subCommands: {
    types,
    fields,
    tags,
  },
});
