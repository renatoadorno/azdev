/**
 * azure-devops-node-api still calls the legacy `url.parse()` (VsoClient.js and
 * WebApi.js, unchanged through v17), so Node emits DEP0169 on every command that
 * touches the API. Nothing here uses the legacy URL API, and the notice pollutes
 * stderr for scripts and AI consumers that read this CLI's output.
 *
 * Only that one code is dropped — every other warning stays visible. Remove this
 * once the SDK moves to the WHATWG URL API.
 */
const SILENCED = new Set(['DEP0169']);

export function silenceDependencyWarnings(): void {
  const emit = process.emitWarning.bind(process);

  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    if (SILENCED.has(warningCode(warning, rest))) return;
    return (emit as (...args: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}

/** The code can arrive as the 3rd positional argument, in an options object, or on the Error. */
function warningCode(warning: unknown, rest: unknown[]): string {
  if (typeof rest[1] === 'string') return rest[1];

  const fromOptions = (rest[0] as { code?: string } | undefined)?.code;
  if (fromOptions) return fromOptions;

  return (warning as { code?: string } | undefined)?.code ?? '';
}
