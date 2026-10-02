import type { WorkItemClassificationNode } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';

export interface SlimAreaNode {
  name?: string;
  path?: string;
}

export interface SlimIterationNode extends SlimAreaNode {
  id?: string;
  startDate?: string;
  finishDate?: string;
}

/** Values of `--sprint` that mean "the team's current iteration". */
export const CURRENT_SPRINT_ALIASES = ['current', '@current'];

// Classification node paths come as "\Project\Area\Sub", which is not a valid
// System.AreaPath/System.IterationPath value ("Project\Sub") — strip the leading
// backslash and the structural "Area"/"Iteration" segment.
export function toFieldPath(path?: string): string | undefined {
  if (!path) return path;
  return path.replace(/^\\/, '').replace(/^([^\\]+)\\(Area|Iteration)(?=\\|$)/, '$1');
}

export function flattenAreas(node: WorkItemClassificationNode): SlimAreaNode[] {
  const flat: SlimAreaNode[] = [{ name: node.name, path: toFieldPath(node.path) }];
  for (const child of node.children ?? []) flat.push(...flattenAreas(child));
  return flat;
}

export function flattenIterations(node: WorkItemClassificationNode): SlimIterationNode[] {
  const flat: SlimIterationNode[] = [{
    id: node.identifier,
    name: node.name,
    path: toFieldPath(node.path),
    startDate: node.attributes?.startDate,
    finishDate: node.attributes?.finishDate,
  }];
  for (const child of node.children ?? []) flat.push(...flattenIterations(child));
  return flat;
}

function trailingNumber(name?: string): string | undefined {
  return name?.match(/(\d+)\s*$/)?.[1];
}

function single(value: string, matches: SlimIterationNode[]): SlimIterationNode | undefined {
  if (matches.length > 1) {
    throw new Error(`Sprint "${value}" is ambiguous: ${matches.map(it => it.path).join(', ')}. Pass the full path.`);
  }
  return matches[0];
}

/**
 * Finds the iteration a `--sprint` value names: a full path (`Project\Sprint 82`),
 * an iteration GUID, an exact name (`Sprint 82`) or the bare number (`82`).
 * Throws when a name or bare number matches more than one iteration
 * (`2025\Sprint 1` and `2026\Sprint 1`) rather than picking one silently.
 */
export function matchIteration(value: string, iterations: SlimIterationNode[]): SlimIterationNode | undefined {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return undefined;

  const byPathOrId = iterations.find(
    it => it.path?.toLowerCase() === wanted || it.id?.toLowerCase() === wanted,
  );
  if (byPathOrId) return byPathOrId;

  const byName = iterations.filter(it => it.name?.toLowerCase() === wanted);
  if (byName.length) return single(value, byName);

  if (!/^\d+$/.test(wanted)) return undefined;
  return single(value, iterations.filter(it => trailingNumber(it.name) === String(Number(wanted))));
}

/** Iteration names closest to a miss, so the error points at the right value. */
export function suggestIterations(value: string, iterations: SlimIterationNode[], limit = 5): string[] {
  const wanted = value.trim().toLowerCase();
  const number = trailingNumber(wanted);
  return iterations
    .filter(it => it.name && (it.name.toLowerCase().includes(wanted) || (number && it.name.includes(number))))
    .slice(0, limit)
    .map(it => it.name!);
}
