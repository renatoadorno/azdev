import type { StatsFilters } from '../interfaces/Stats';
import { loadOperationalTypes } from './flows';
import { failUsage, parseCsv } from './parsers';

/** Filter flags every stats command shares. */
export const statsFilterArgs = {
  mine: { type: 'boolean' as const, description: 'Only items assigned to me' },
  assignedTo: { type: 'string' as const, description: "Only items assigned to this user (e-mail or name; '@me' = you)" },
  type: { type: 'string' as const, description: 'Only these work item types, comma-separated' },
  product: { type: 'boolean' as const, description: 'Leave out the operationalTypes of flows.json (support, meetings, hot fixes)' },
};

export function statsFilters(args: { mine?: boolean; assignedTo?: string; type?: string; product?: boolean }): StatsFilters {
  if (args.mine && args.assignedTo) failUsage('Pass --mine or --assignedTo, not both');
  const excludeTypes = args.product ? loadOperationalTypes() : undefined;
  if (args.product && !excludeTypes?.length) failUsage('--product needs "operationalTypes" in flows.json');
  return { mine: args.mine, assignedTo: args.assignedTo, types: parseCsv(args.type), excludeTypes };
}
