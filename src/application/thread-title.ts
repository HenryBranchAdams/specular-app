const MAX_LOCAL_TITLE_LENGTH = 80;
const DRAFTING_PREFIX = /^(?:i(?:['’]m| am)\s+(?:exploring|considering|thinking about|trying to understand)\s+|i\s+(?:want|need|plan|hope)\s+to\s+|my current thesis is\s+|the idea is\s+)/iu;
const TERMINAL_PUNCTUATION = /[,:;.!?\s–—-]+$/u;

function capitalize(value: string): string {
  return value.replace(/^\p{L}/u, (character) => character.toLocaleUpperCase());
}

function truncate(value: string): string {
  if (value.length <= MAX_LOCAL_TITLE_LENGTH) {
    return value;
  }
  const bounded = value.slice(0, MAX_LOCAL_TITLE_LENGTH - 1);
  const lastSpace = bounded.lastIndexOf(' ');
  const readable = lastSpace > 0 ? bounded.slice(0, lastSpace) : bounded;
  return readable.trimEnd() + '…';
}

export function deriveThreadTitle(content: string): string {
  const normalized = content.trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0) {
    return 'New topic';
  }
  const [firstSentence = normalized] = normalized.split(/[.!?](?:\s|$)/u, 1);
  const withoutDraftingPrefix = firstSentence.replace(DRAFTING_PREFIX, '');
  const cleaned = withoutDraftingPrefix.replace(TERMINAL_PUNCTUATION, '').trim();
  if (cleaned.length === 0) {
    return 'New topic';
  }
  return truncate(capitalize(cleaned));
}
