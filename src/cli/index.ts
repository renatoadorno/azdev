import { defineCommand, runMain } from 'citty';
import pkg from '../../package.json';
import workitem from './commands/workitem';
import sprint from './commands/sprint';
import board from './commands/board';
import project from './commands/project';
import metadata from './commands/metadata';
import config from './commands/config';
import { silenceDependencyWarnings } from './warnings';

// Injected at compile time by build.js (--define). Undefined when running from
// source, where package.json is the source of truth.
declare const BUILD_VERSION: string | undefined;
const version = typeof BUILD_VERSION === 'string' ? BUILD_VERSION : pkg.version;

silenceDependencyWarnings();

const main = defineCommand({
  meta: { name: 'azdev', version, description: 'Azure DevOps CLI — optimized for AI consumers' },
  subCommands: { workitem, sprint, board, project, metadata, config },
});

runMain(main);
