import type { PublishedSnapshot } from './share-client';

function safeFilename(title: string): string {
  const value = title.toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return value.length === 0 ? 'specular-snapshot' : value;
}

export function snapshotToMarkdown(snapshot: PublishedSnapshot): string {
  const lines = [`# ${snapshot.title}`, ''];
  for (const block of snapshot.blocks) {
    if (block.kind === 'reference') {
      lines.push(`> ${block.content.replace(/\n/gu, '\n> ')}`, '');
    } else {
      lines.push(block.content, '');
    }
  }
  const references = snapshot.blocks.flatMap((block) => block.references);
  if (references.length > 0) {
    lines.push('## References', '');
    for (const reference of references) {
      const author = reference.author.length > 0 ? `${reference.author}. ` : '';
      const url = reference.url.length > 0 ? ` ${reference.url}` : '';
      lines.push(`- ${author}${reference.title}.${url}`);
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

export function downloadMarkdown(snapshot: PublishedSnapshot): void {
  const blob = new Blob([snapshotToMarkdown(snapshot)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = `${safeFilename(snapshot.title)}.md`;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}
