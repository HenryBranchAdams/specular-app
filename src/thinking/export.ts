import type { PublishedSnapshot } from './share-client';

export function snapshotFilename(title: string): string {
  let withoutControlCharacters = '';
  for (const character of title.trim()) {
    withoutControlCharacters += character.charCodeAt(0) < 32 ? '-' : character;
  }
  const value = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .slice(0, 120);
  return value.length === 0 ? 'Specular snapshot' : value;
}

export function snapshotToMarkdown(snapshot: PublishedSnapshot): string {
  const lines = [`# ${snapshot.title}`, ''];
  for (const block of snapshot.blocks) {
    if (block.references.length > 0) {
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
  anchor.download = `${snapshotFilename(snapshot.title)}.md`;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function printSnapshot(snapshot: PublishedSnapshot): void {
  const previousTitle = document.title;
  const restoreTitle = () => {
    document.title = previousTitle;
    globalThis.removeEventListener('afterprint', restoreTitle);
  };
  document.title = snapshotFilename(snapshot.title);
  globalThis.addEventListener('afterprint', restoreTitle, { once: true });
  try {
    globalThis.print();
  } catch (error) {
    restoreTitle();
    throw error;
  }
}
