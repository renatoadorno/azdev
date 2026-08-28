import { defineCommand } from 'citty';
import { ProjectService } from '../../services/ProjectService';
import { globalOptions, runService } from '../command';

const list = defineCommand({
  meta: { name: 'list', description: 'List projects' },
  args: {
    ...globalOptions,
    top: { type: 'string', description: 'Max results' },
    skip: { type: 'string', description: 'Skip N results' },
    state: { type: 'string', description: 'State filter (all, wellFormed, etc.)' },
  },
  async run({ args }) {
    await runService(ProjectService, args, (svc) =>
      svc.listProjects({
        top: args.top ? Number(args.top) : undefined,
        skip: args.skip ? Number(args.skip) : undefined,
        stateFilter: args.state as any,
      }),
    );
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
    await runService(ProjectService, args, (svc) =>
      svc.getProjectDetails({
        projectId: args.projectId!,
        includeCapabilities: args.capabilities,
      }),
    );
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
    await runService(ProjectService, args, (svc) => {
      if (args.visibility !== 'private' && args.visibility !== 'public') {
        throw new Error(`Invalid --visibility "${args.visibility}": must be "private" or "public"`);
      }
      return svc.createProject({
        name: args.name!,
        description: args.description,
        visibility: args.visibility,
      });
    });
  },
});

const areas = defineCommand({
  meta: { name: 'areas', description: 'Get project areas' },
  args: {
    ...globalOptions,
    projectId: { type: 'positional', description: 'Project ID or name', required: true },
  },
  async run({ args }) {
    await runService(ProjectService, args, (svc) =>
      svc.getAreas({
        projectId: args.projectId!,
      }),
    );
  },
});

const iterations = defineCommand({
  meta: { name: 'iterations', description: 'Get project iterations' },
  args: {
    ...globalOptions,
    projectId: { type: 'positional', description: 'Project ID or name', required: true },
  },
  async run({ args }) {
    await runService(ProjectService, args, (svc) => svc.getIterations({ projectId: args.projectId! }));
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
    await runService(ProjectService, args, (svc) =>
      svc.createArea({
        projectId: args.projectId!,
        name: args.name!,
        parentPath: args.parentPath,
      }),
    );
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
    await runService(ProjectService, args, (svc) =>
      svc.createIteration({
        projectId: args.projectId!,
        name: args.name!,
        parentPath: args.parentPath,
        startDate: args.startDate,
        finishDate: args.finishDate,
      }),
    );
  },
});

const processes = defineCommand({
  meta: { name: 'processes', description: 'Get available processes' },
  args: { ...globalOptions },
  async run({ args }) {
    await runService(ProjectService, args, (svc) => svc.getProcesses({}));
  },
});

const workItemTypes = defineCommand({
  meta: {
    name: 'work-item-types',
    description: "Get work item types for a process — process-scoped (requires processId); for the current project's types and states use: azdev metadata types",
  },
  args: {
    ...globalOptions,
    processId: { type: 'positional', description: 'Process ID', required: true },
  },
  async run({ args }) {
    await runService(ProjectService, args, (svc) => svc.getWorkItemTypes({ processId: args.processId! }));
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
    await runService(ProjectService, args, (svc) =>
      svc.getWorkItemTypeFields({
        processId: args.processId!,
        witRefName: args.witRefName!,
      }),
    );
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
