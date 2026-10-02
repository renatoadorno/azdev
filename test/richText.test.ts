import { describe, expect, it } from 'bun:test';
import {
  attachmentFileName,
  decodeEntities,
  extractAttachmentUrls,
  htmlToText,
  parseAttachmentUrl,
  richTextToPlain,
} from '../src/services/richText';

const ATT = 'https://dev.azure.com/acme/b3f9/_apis/wit/attachments/7c9c771e-cce2-4f78-b376-416c4f83f6db';

describe('decodeEntities', () => {
  it('decodes the named entities Azure DevOps stores', () => {
    expect(decodeEntities('&quot;a&quot; &gt; b &lt; c &amp; d&nbsp;e &apos;f&apos;')).toBe(`"a" > b < c & d e 'f'`);
  });

  it('decodes decimal and hex code points, including astral ones', () => {
    expect(decodeEntities('&#129513; &#x1F9E9; &#233;')).toBe('🧩 🧩 é');
  });

  it('leaves unknown entities untouched', () => {
    expect(decodeEntities('&bogus; &')).toBe('&bogus; &');
  });
});

describe('htmlToText', () => {
  it('turns the UI comment markup into lines', () => {
    expect(htmlToText('<div>linha 1</div><div>linha 2<br>linha 3</div>')).toBe('linha 1\nlinha 2\nlinha 3');
  });

  it('reads mentions as their label, not their plumbing href', () => {
    const html =
      '<div><a href="#" data-vss-mention="version:2.0,6d8c">@Alice</a>&nbsp;veja ' +
      '<a href="https://dev.azure.com/acme/P/_workitems/edit/14041/" data-vss-mention="version:1.0">#14041</a></div>';
    expect(htmlToText(html)).toBe('@Alice veja #14041');
  });

  it('keeps a real link as markdown and a bare url as itself', () => {
    expect(htmlToText('<a href="https://x.dev/pr/1">PR 1</a>')).toBe('[PR 1](https://x.dev/pr/1)');
    expect(htmlToText('<a href="https://x.dev">https://x.dev</a>')).toBe('https://x.dev');
  });

  it('keeps images as markdown so their urls survive', () => {
    expect(htmlToText(`<p>antes <img src="${ATT}?fileName=a.png" alt="tela"> depois</p>`)).toBe(`antes ![tela](${ATT}?fileName=a.png) depois`);
  });

  it('renders headings, lists and emphasis', () => {
    const html = '<h3>Contexto</h3><ul><li>um</li><li><b>dois</b></li></ul><p>use <code>bun test</code></p>';
    expect(htmlToText(html)).toBe('### Contexto\n- um\n- **dois**\nuse `bun test`');
  });

  it('treats newlines in the stored source as whitespace, not as line breaks', () => {
    expect(htmlToText('<div>@Alice&nbsp;</div>\n<div>Teste feito</div>')).toBe('@Alice\nTeste feito');
  });

  it('keeps one blank line for the empty lines the editor stores as <div><br></div>', () => {
    const html = '<div>a   </div><div><br></div><div><br></div><div><br></div><div>b</div>';
    expect(htmlToText(html)).toBe('a\n\nb');
  });
});

describe('richTextToPlain', () => {
  it('only decodes entities for a Markdown field — the text is already readable', () => {
    expect(richTextToPlain('&gt; citação\n\n## Título', 'markdown')).toBe('> citação\n\n## Título');
  });

  it('converts an HTML field', () => {
    expect(richTextToPlain('<div>a</div><div>b</div>', undefined)).toBe('a\nb');
  });

  it('returns undefined for an empty or absent field', () => {
    expect(richTextToPlain('', 'markdown')).toBeUndefined();
    expect(richTextToPlain(undefined, undefined)).toBeUndefined();
  });
});

describe('attachments in rich text', () => {
  it('finds attachment urls in markdown, img tags and plain text, once each', () => {
    const text = `![a](${ATT}?fileName=a.png) <img src="${ATT}?fileName=a.png"> ver ${ATT.replace('7c9c', '1111')}?fileName=b.pdf.`;
    expect(extractAttachmentUrls(text)).toEqual([`${ATT}?fileName=a.png`, `${ATT.replace('7c9c', '1111')}?fileName=b.pdf.`]);
  });

  it('decodes &amp; inside a stored url', () => {
    expect(extractAttachmentUrls(`<img src="${ATT}?fileName=a.png&amp;download=true">`)).toEqual([`${ATT}?fileName=a.png&download=true`]);
  });

  it('ignores urls that are not work item attachments', () => {
    expect(extractAttachmentUrls('https://dev.azure.com/acme/_git/repo/pullrequest/66')).toEqual([]);
  });

  it('parses the attachment id and file name', () => {
    expect(parseAttachmentUrl(`${ATT}?fileName=tela%201.png`)).toEqual({ id: '7c9c771e-cce2-4f78-b376-416c4f83f6db', fileName: 'tela 1.png' });
    expect(parseAttachmentUrl('https://x.dev/nope')).toBeUndefined();
  });

  it('builds a local name that cannot escape the download directory', () => {
    expect(attachmentFileName({ id: '7c9c771e-cce2', fileName: '../../etc/passwd' })).toBe('7c9c771e-passwd');
    expect(attachmentFileName({ id: '7c9c771e-cce2', fileName: 'tela 1.png' })).toBe('7c9c771e-tela_1.png');
    expect(attachmentFileName({ id: '7c9c771e-cce2' })).toBe('7c9c771e-attachment');
  });
});
