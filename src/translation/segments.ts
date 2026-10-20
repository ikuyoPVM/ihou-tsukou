export interface TextPiece {
  text: string;
  separator: string;
}

/**
 * Split long text at paragraph/sentence/word boundaries. Separators are kept
 * separately so translated pieces can be re-joined without inventing spaces.
 */
export function splitLongText(text: string, maxChars = 1800): TextPiece[] {
  if (!text.trim()) return [{ text, separator: '' }];
  const limit = Math.max(80, maxChars);
  const pieces: TextPiece[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const cut = findCut(window);
    let piece = remaining.slice(0, cut);
    remaining = remaining.slice(cut);
    let separator = '';
    const trailing = piece.match(/\s+$/)?.[0] ?? '';
    if (trailing) {
      piece = piece.slice(0, -trailing.length);
      separator += trailing;
    }
    const leading = remaining.match(/^\s+/)?.[0] ?? '';
    if (leading) {
      separator += leading;
      remaining = remaining.slice(leading.length);
    }
    if (piece) pieces.push({ text: piece, separator });
  }
  const tail = remaining.trim();
  if (tail) {
    const leading = remaining.match(/^\s+/)?.[0] ?? '';
    if (leading && pieces.length > 0) {
      pieces[pieces.length - 1]!.separator += leading;
    }
    pieces.push({ text: tail, separator: '' });
  }
  if (pieces.length === 0) return [{ text, separator: '' }];
  return pieces;
}

function findCut(window: string): number {
  const min = Math.floor(window.length * 0.55);
  const newline = window.lastIndexOf('\n');
  if (newline >= min) return newline + 1;
  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
    window.lastIndexOf('。'),
    window.lastIndexOf('！'),
    window.lastIndexOf('？'),
    window.lastIndexOf('；'),
    window.lastIndexOf('; '),
  );
  if (sentence >= min) {
    return sentence + (window[sentence] === '.' || window[sentence] === '!' || window[sentence] === '?' ? 1 : 1);
  }
  const space = window.lastIndexOf(' ');
  if (space >= min) return space;
  return window.length;
}

export function packTexts(
  texts: string[],
  maxChars = 3600,
  maxItems = 12,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const text of texts) {
    const length = text.length;
    if (
      current.length > 0 &&
      (current.length >= maxItems || currentChars + length > maxChars)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(text);
    currentChars += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function joinTranslatedPieces(pieces: TextPiece[], translations: string[]): string {
  return pieces.map((piece, index) => `${translations[index] ?? ''}${piece.separator}`).join('');
}