import { defineCommand, runMain } from 'citty';
import workitem from './commands/workitem';
import sprint from './commands/sprint';
import board from './commands/board';
import project from './commands/project';
import metadata from './commands/metadata';
import flow from './commands/flow';
import stats from './commands/stats';
import config from './commands/config';
import serve from './commands/serve';
import { silenceDependencyWarnings } from './warnings';
import { VERSION } from './version';

silenceDependencyWarnings();

const main = defineCommand({
  meta: { name: 'azdev', version: VERSION, description: 'Azure DevOps CLI — optimized for AI consumers' },
  subCommands: { workitem, sprint, board, project, metadata, flow, stats, config, serve },
});

runMain(main);
