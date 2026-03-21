import { defineCommand } from 'citty';
import { ProjectService } from '../../services/ProjectService';
import { loadCliConfig } from '../config';
import { format } from '../formatters/index';

const globalOptions = {
  json: { type: 'boolean' as const, description: 'Output as JSON' },
  markdown: { type: 'boolean' as const, description: 'Output as Markdown' },
  project: { type: 'string' as const, description: 'Override project from config' },
};

function getService(options: { project?: string }) {
  const config = loadCliConfig();
  if (options.project) config.project = options.project;
  return new ProjectService(config);
}

const list = defineCommand({
  meta: { name: 'list', description: 'List projects' },
  args: {
    ...globalOptions,
    top: { type: 'string', description: 'Max results' },
    skip: { type: 'string', description: 'Skip N results' },
    state: { type: 'string', description: 'State filter (all, wellFormed, etc.)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.listProjects({
        top: args.top ? Number(args.top) : undefined,
        skip: args.skip ? Number(args.skip) : undefined,
        stateFilter: args.state as any,
      });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const get = defineCommand({
  meta: { name: 'get', description: 'Get project details' },
  args: {
    ...globalOptions,
    projectId: { type: 'positional', description: 'Project ID or name', required: true },
    capabilities: { type: 'boolean', description: 'Include capabilities' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getProjectDetails({
        projectId: args.projectId!,
        includeCapabilities: args.capabilities,
      });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const create = defineCommand({
  meta: { name: 'create', description: 'Create a new project' },
  args: {
    ...globalOptions,
    name: { type: 'string', description: 'Project name', required: true },
    description: { type: 'string', description: 'Project description' },
    visibility: { type: 'string', description: 'Visibility: private or public', default: 'private' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.createProject({
        name: args.name!,
        description: args.description,
        visibility: args.visibility as 'private' | 'public',
      });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const areas = defineCommand({
  meta: { name: 'areas', description: 'Get project areas' },
  args: {
    ...globalOptions,
    projectId: { type: 'positional', description: 'Project ID or name', required: true },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getAreas({
        projectId: args.projectId!,
      });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const iterations = defineCommand({
  meta: { name: 'iterations', description: 'Get project iterations' },
  args: {
    ...globalOptions,
    projectId: { type: 'positional', description: 'Project ID or name', required: true },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getIterations({ projectId: args.projectId! });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const createArea = defineCommand({
  meta: { name: 'create-area', description: 'Create a project area' },
  args: {
    ...globalOptions,
    projectId: { type: 'string', description: 'Project ID or name', required: true },
    name: { type: 'string', description: 'Area name', required: true },
    parentPath: { type: 'string', description: 'Parent area path' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.createArea({
        projectId: args.projectId!,
        name: args.name!,
        parentPath: args.parentPath,
      });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const createIteration = defineCommand({
  meta: { name: 'create-iteration', description: 'Create a project iteration' },
  args: {
    ...globalOptions,
    projectId: { type: 'string', description: 'Project ID or name', required: true },
    name: { type: 'string', description: 'Iteration name', required: true },
    parentPath: { type: 'string', description: 'Parent iteration path' },
    startDate: { type: 'string', description: 'Start date (ISO)' },
    finishDate: { type: 'string', description: 'Finish date (ISO)' },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.createIteration({
        projectId: args.projectId!,
        name: args.name!,
        parentPath: args.parentPath,
        startDate: args.startDate,
        finishDate: args.finishDate,
      });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const processes = defineCommand({
  meta: { name: 'processes', description: 'Get available processes' },
  args: { ...globalOptions },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getProcesses({});
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const workItemTypes = defineCommand({
  meta: { name: 'work-item-types', description: 'Get work item types for a process' },
  args: {
    ...globalOptions,
    processId: { type: 'positional', description: 'Process ID', required: true },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getWorkItemTypes({ processId: args.processId! });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

const workItemFields = defineCommand({
  meta: { name: 'work-item-fields', description: 'Get fields for a work item type' },
  args: {
    ...globalOptions,
    processId: { type: 'string', description: 'Process ID', required: true },
    witRefName: { type: 'string', description: 'Work item type reference name', required: true },
  },
  async run({ args }) {
    try {
      const svc = getService(args);
      const result = await svc.getWorkItemTypeFields({
        processId: args.processId!,
        witRefName: args.witRefName!,
      });
      console.log(format(result, args));
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  },
});

export default defineCommand({
  meta: { name: 'project', description: 'Project commands' },
  subCommands: {
    list,
    get,
    create,
    areas,
    iterations,
    'create-area': createArea,
    'create-iteration': createIteration,
    processes,
    'work-item-types': workItemTypes,
    'work-item-fields': workItemFields,
  },
});
