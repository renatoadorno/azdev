import { defineCommand, runMain } from 'citty';
import pkg from '../../package.json';
import workitem from './commands/workitem';
import sprint from './commands/sprint';
import board from './commands/board';
import project from './commands/project';
import config from './commands/config';

const main = defineCommand({
  meta: { name: 'azdev', version: pkg.version, description: 'Azure DevOps CLI — optimized for AI consumers' },
  subCommands: { workitem, sprint, board, project, config },
});

runMain(main);
