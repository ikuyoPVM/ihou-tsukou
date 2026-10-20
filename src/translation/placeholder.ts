import type { GlossaryEntry } from '../shared/types';
import { AppError } from '../shared/errors';

export interface ProtectedText {
  text: string;
  replacements: Array<{ token: string; value: string; kind: 'glossary' | 'url' | 'email' }>;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'）)】\]]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeToken(text: string, index: number): string {
  let token = `⟦P${index}⟧`;
  while (text.includes(token)) token = `⟦${index}P⟧`;
  return token;
}

/**
 * Protect URLs, e-mail addresses and glossary terms with opaque tokens before
 * sending text to a model. User glossary targets are restored locally, which
 * prevents the model from silently dropping required terminology.
 */
export function protectText(text: string, glossary: GlossaryEntry[] = []): ProtectedText {
  let output = text;
  const replacements: ProtectedText['replacements'] = [];
  let index = 0;

  const replaceWithToken = (value: string, kind: 'url' | 'email' | 'glossary', target?: string) => {
    if (!value) return;
    const token = makeToken(output, index);
    index += 1;
    replacements.push({ token, value: target ?? value, kind });
    output = output.split(value).join(token);
  };

  const urls = [...new Set(output.match(URL_PATTERN) ?? [])];
  for (const url of urls) replaceWithToken(url, 'url');
  const emails = [...new Set(output.match(EMAIL_PATTERN) ?? [])];
  for (const email of emails) replaceWithToken(email, 'email');

  const sorted = [...glossary]
    .filter((entry) => entry.source.trim() && entry.target.trim())
    .sort((a, b) => b.source.length - a.source.length);
  for (const entry of sorted) {
    const flags = entry.caseSensitive ? 'g' : 'gi';
    const pattern = new RegExp(escapeRegExp(entry.source), flags);
    const matches = [...new Set(output.match(pattern) ?? [])];
    for (const match of matches) replaceWithToken(match, 'glossary', entry.target);
  }

  return { text: output, replacements };
}

export function restoreText(text: string, protectedText: ProtectedText): string {
  let output = text;
  const missing: string[] = [];
  for (const replacement of protectedText.replacements) {
    if (!output.includes(replacement.token)) {
      missing.push(replacement.token);
      continue;
    }
    output = output.split(replacement.token).join(replacement.value);
  }
  if (missing.length > 0) {
    throw new AppError(
      'INVALID_RESPONSE',
      `模型未能保留 ${missing.length} 个受保护术语或链接占位符，为避免内容损坏已保留原文。`,
    );
  }
  return output;
}

export function describeGlossary(glossary: GlossaryEntry[]): string {
  if (glossary.length === 0) return '';
  return glossary
    .slice(0, 100)
    .map((entry) => `- ${entry.source} => ${entry.target}${entry.caseSensitive ? '（区分大小写）' : ''}`)
    .join('\n');
}