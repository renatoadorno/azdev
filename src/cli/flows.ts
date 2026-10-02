import * as fs from 'fs';
import type { FlowsFile } from '../interfaces/Flows';
import { validateFlows } from '../services/flowRules';
import { siblingPath } from './config';

/** flows.json lives next to config.json, so AZDEV_CONFIG_PATH isolates both. */
export function flowsPath(): string {
  return siblingPath('flows.json');
}

function readFlowsFile(): unknown | null {
  let content: string;
  try {
    content = fs.readFileSync(flowsPath(), 'utf-8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch (err) {
    console.error(`Flows file at ${flowsPath()} is not valid JSON: ${(err as Error).message}`);
    process.exit(2);
  }
}

function validOrExit(raw: unknown): FlowsFile {
  try {
    return validateFlows(raw);
  } catch (err) {
    console.error(`${flowsPath()}: ${(err as Error).message}`);
    process.exit(2);
  }
}

/** The flows file; a missing one is fatal (exit 2), like a missing config. */
export function loadFlows(): FlowsFile {
  const raw = readFlowsFile();
  if (raw !== null) return validOrExit(raw);

  console.error(`No flows defined: ${flowsPath()} does not exist.`);
  console.error('Create it with your team\'s story cycle — see "Flows" in docs/commands.md.');
  process.exit(2);
}

/** The flows file, or null when it does not exist — for commands that only read its settings. */
export function loadOptionalFlows(): FlowsFile | null {
  const raw = readFlowsFile();
  return raw === null ? null : validOrExit(raw);
}

/** `operationalTypes` from the flows file, or none when the file does not exist. */
export function loadOperationalTypes(): string[] {
  return loadOptionalFlows()?.operationalTypes ?? [];
}
