/**
 * Rich-text fields (description, acceptance criteria, comments) come back as HTML,
 * or as Markdown that Azure DevOps still HTML-encodes on storage (`&gt;`, `&quot;`).
 * These helpers turn both into plain readable text for AI consumers.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeEntities(match[2] ?? match[3] ?? '') : undefined;
}

// Marks a block boundary; a run of them (</div><div>) becomes a single line break.
const BLOCK = '\u0000';

export function htmlToText(html: string): string {
  const text = html
    // Source newlines are whitespace in HTML; line breaks come from <br> and blocks.
    .replace(/\r?\n/g, ' ')
    .replace(/<img\b[^>]*>/gi, tag => `![${attr(tag, 'alt') ?? ''}](${attr(tag, 'src') ?? ''})`)
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      const href = attr(` ${attrs}`, 'href');
      // Mentions (@user, #work-item) read as their label; the href is UI plumbing.
      if (/data-vss-mention/i.test(attrs) || !href || href === '#') return label;
      return decodeEntities(label) === href ? href : `[${label}](${href})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `${BLOCK}${'#'.repeat(Number(level))} `)
    .replace(/<li\b[^>]*>/gi, `${BLOCK}- `)
    .replace(/<(strong|b)\b[^>]*>|<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)\b[^>]*>|<\/(em|i)>/gi, '_')
    .replace(/<\/?code\b[^>]*>/gi, '`')
    .replace(/<\/?pre\b[^>]*>/gi, `${BLOCK}\`\`\`${BLOCK}`)
    .replace(/<\/?(div|p|h[1-6]|li|tr|ul|ol|table|blockquote)\b[^>]*>/gi, BLOCK)
    .replace(/<\/?(td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(new RegExp(`(?:[ \\t]*${BLOCK}[ \\t]*)+`, 'g'), '\n');

  return decodeEntities(text)
    .split('\n')
    .map(line => line.replace(/[ \t ]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Readable text of a rich-text value, given the format Azure DevOps reports for it. */
export function richTextToPlain(value: unknown, format?: string): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  return format?.toLowerCase() === 'markdown' ? decodeEntities(value).trim() : htmlToText(value);
}

const ATTACHMENT_URL = /https?:\/\/[^\s"'<>()\[\]]+\/_apis\/wit\/attachments\/[0-9a-f-]{36}[^\s"'<>()\[\]]*/gi;

/** Attachment urls embedded in a rich-text value (`<img src>`, `![](...)`, plain links). */
export function extractAttachmentUrls(text?: string): string[] {
  if (!text) return [];
  const urls = (text.match(ATTACHMENT_URL) ?? []).map(url => decodeEntities(url));
  return [...new Set(urls)];
}

export interface AttachmentRef {
  id: string;
  fileName?: string;
}

/** `…/_apis/wit/attachments/<guid>?fileName=x.png` → `{ id, fileName }`. */
export function parseAttachmentUrl(url: string): AttachmentRef | undefined {
  const match = url.match(/\/_apis\/wit\/attachments\/([0-9a-f-]{36})/i);
  if (!match) return undefined;
  let fileName: string | undefined;
  try {
    fileName = new URL(url).searchParams.get('fileName') ?? undefined;
  } catch {
    fileName = undefined;
  }
  return { id: match[1]!.toLowerCase(), fileName };
}

/** Safe local file name for a downloaded attachment: no path segments, guid-prefixed. */
export function attachmentFileName(ref: AttachmentRef): string {
  const base = (ref.fileName ?? 'attachment').split(/[\\/]/).pop()!.replace(/[^\w.\-]+/g, '_') || 'attachment';
  return `${ref.id.slice(0, 8)}-${base}`;
}
