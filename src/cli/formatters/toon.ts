import { encode } from '@toon-format/toon';

export function formatToon(data: unknown): string {
  return encode(data);
}
