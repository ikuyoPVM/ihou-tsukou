import { AppError } from '../shared/errors';

export interface ParsedTranslation {
  id: string;
  text: string;
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence?.[1]?.trim() ?? trimmed;
}

function tryParseJson(content: string): unknown {
  const cleaned = stripCodeFence(content);
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstObject = cleaned.indexOf('{');
    const lastObject = cleaned.lastIndexOf('}');
    if (firstObject >= 0 && lastObject > firstObject) {
      try {
        return JSON.parse(cleaned.slice(firstObject, lastObject + 1));
      } catch {
        // Continue below.
      }
    }
    const firstArray = cleaned.indexOf('[');
    const lastArray = cleaned.lastIndexOf(']');
    if (firstArray >= 0 && lastArray > firstArray) {
      try {
        return JSON.parse(cleaned.slice(firstArray, lastArray + 1));
      } catch {
        // Continue below.
      }
    }
    throw new AppError('INVALID_RESPONSE', '模型返回的翻译结果不是合法 JSON。');
  }
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const candidates = [record.translations, record.results, record.segments];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
  }
  throw new AppError('INVALID_RESPONSE', '模型返回的 JSON 中缺少 translations 数组。');
}

/**
 * Parse and validate model output. HTML and markdown from the model are never
 * executed; only plain text values are returned.
 */
export function parseTranslationPayload(content: string, expectedIds: string[]): ParsedTranslation[] {
  if (!content.trim()) {
    throw new AppError('INVALID_RESPONSE', '模型返回了空内容。');
  }
  const items = extractItems(tryParseJson(content));
  if (items.length !== expectedIds.length) {
    throw new AppError(
      'INVALID_RESPONSE',
      `模型返回 ${items.length} 条译文，但请求包含 ${expectedIds.length} 段，数量不一致。`,
    );
  }

  const byId = new Map<string, string>();
  const positional: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      positional.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') {
      throw new AppError('INVALID_RESPONSE', '模型返回的译文条目格式无效。');
    }
    const record = item as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text : typeof record.translation === 'string' ? record.translation : null;
    if (text === null) {
      throw new AppError('INVALID_RESPONSE', '模型返回的译文条目缺少 text 字段。');
    }
    const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : null;
    if (id !== null) {
      if (byId.has(id)) {
        throw new AppError('INVALID_RESPONSE', `模型重复返回了 id=${id} 的译文。`);
      }
      byId.set(id, text);
    }
    positional.push(text);
  }

  const hasAllIds = expectedIds.every((id) => byId.has(id));
  const results: ParsedTranslation[] = expectedIds.map((id, index) => {
    const text = hasAllIds ? byId.get(id) : positional[index];
    if (typeof text !== 'string') {
      throw new AppError('INVALID_RESPONSE', `模型返回结果缺少 id=${id} 的译文。`);
    }
    return { id, text };
  });
  if (!hasAllIds && byId.size > 0) {
    throw new AppError('INVALID_RESPONSE', '模型返回的 id 与请求不匹配。');
  }
  for (const result of results) {
    if (!result.text.trim()) {
      throw new AppError('INVALID_RESPONSE', `id=${result.id} 的译文为空。`);
    }
  }
  return results;
}