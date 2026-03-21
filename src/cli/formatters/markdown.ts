export function formatMarkdown(data: unknown): string {
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    const keys = Object.keys(data[0]);
    const header = `| ${keys.join(' | ')} |`;
    const separator = `| ${keys.map(() => '---').join(' | ')} |`;
    const rows = data.map((row: Record<string, unknown>) =>
      `| ${keys.map(k => String(row[k] ?? '')).join(' | ')} |`
    );
    return [header, separator, ...rows].join('\n');
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `**${k}**: ${typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}`)
      .join('\n');
  }

  return String(data);
}
