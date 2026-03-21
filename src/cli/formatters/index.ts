import { formatToon } from './toon';
import { formatJson } from './json';
import { formatMarkdown } from './markdown';

export function format(data: unknown, flags: { json?: boolean; markdown?: boolean }): string {
  if (flags.json) return formatJson(data);
  if (flags.markdown) return formatMarkdown(data);
  return formatToon(data);
}
