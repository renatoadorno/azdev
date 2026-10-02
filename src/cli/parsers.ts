import * as fs from 'fs';
import type { RichTextFormat } from '../interfaces/WorkItems';

/** Invalid usage: one-line message, exit 1, before any API call. */
export function failUsage(message: string): never {
  console.error(message);
  process.exit(1);
}

export function parseId(value: unknown, label = 'work item ID'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) failUsage(`Invalid ${label}: ${value}`);
  return n;
}

export function parseOptionalId(value: unknown, label: string): number | undefined {
  return value === undefined || value === '' ? undefined : parseId(value, label);
}

/** Non-negative integer flag (`--top`, `--comments`). */
export function parseCount(value: unknown, label: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) failUsage(`Invalid ${label}: ${value}`);
  return n;
}

export function parseCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export function parseRichTextFormat(value?: string): RichTextFormat | undefined {
  if (!value) return undefined;
  if (value !== 'html' && value !== 'markdown') failUsage(`--format must be 'html' or 'markdown' (got '${value}')`);
  return value;
}

/** Contents of a `--*File` flag; `-` reads stdin. Keeps long, quote-heavy text out of the shell. */
export function readTextFile(file: string, label: string): string {
  try {
    return fs.readFileSync(file === '-' ? 0 : file, 'utf-8');
  } catch (err) {
    failUsage(`Cannot read ${label} '${file}': ${(err as Error).message}`);
  }
}

/** The value of a text flag or of its file twin; passing both is a usage error. */
export function textOrFile(text: string | undefined, file: string | undefined, names: [string, string]): string | undefined {
  if (text !== undefined && file !== undefined) failUsage(`Pass --${names[0]} or --${names[1]}, not both`);
  return file !== undefined ? readTextFile(file, `--${names[1]}`) : text;
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    failUsage(`${label} is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) failUsage(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}
