function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(rows: Record<string, unknown>[]): string {
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const header = `| ${keys.join(' | ')} |`;
  const separator = `| ${keys.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${keys.map(k => cell(row[k])).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

export function formatMarkdown(data: unknown): string {
  if (Array.isArray(data)) {
    return isObjectArray(data) ? table(data) : data.map(cell).join('\n');
  }

  if (typeof data === 'object' && data !== null) {
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) =>
        isObjectArray(v)
          ? `**${k}**:\n\n${table(v)}`
          : `**${k}**: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')}`
      )
      .join('\n');
  }

  return String(data);
}
