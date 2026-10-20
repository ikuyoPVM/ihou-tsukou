import { SUBTITLE_MAX_CUES } from '../shared/constants';
import { AppError } from '../shared/errors';
import { stripBom } from '../shared/utils';

export type SubtitleFormat = 'srt' | 'vtt';

export interface ParsedSubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface SubtitleParseResult {
  format: SubtitleFormat;
  cues: ParsedSubtitleCue[];
  warnings: string[];
}

const TIMESTAMP = '(?:(\\d{1,3}):)?(\\d{1,2}):(\\d{2})[.,](\\d{1,3})';
const TIMING_LINE = new RegExp(`${TIMESTAMP}\\s*-->\\s*${TIMESTAMP}`);

function parseTimestamp(hours: string | undefined, minutes: string, seconds: string, millis: string): number {
  const h = hours ? Number(hours) : 0;
  const m = Number(minutes);
  const s = Number(seconds);
  const ms = Number(millis.padEnd(3, '0').slice(0, 3));
  if (![h, m, s, ms].every(Number.isFinite)) return Number.NaN;
  if (m > 59 || s > 59) return Number.NaN;
  return h * 3600 + m * 60 + s + ms / 1000;
}

export function sanitizeSubtitleText(input: string): string {
  const withBreaks = input.replace(/<br\s*\/?>/gi, '\n');
  const withoutTags = withBreaks.replace(/<[^>]*>/g, '');
  const decoded = withoutTags.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
    };
    const lower = entity.toLowerCase();
    if (lower in named) return named[lower] ?? match;
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return match;
  });
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 5000);
}

function parseBlock(block: string, index: number): ParsedSubtitleCue | null {
  const lines = block.split('\n');
  const timingIndex = lines.findIndex((line) => line.includes('-->'));
  if (timingIndex < 0) return null;
  const timingLine = lines[timingIndex] ?? '';
  const match = timingLine.match(TIMING_LINE);
  if (!match) return null;
  const start = parseTimestamp(match[1], match[2]!, match[3]!, match[4]!);
  const end = parseTimestamp(match[5], match[6]!, match[7]!, match[8]!);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) return null;
  const text = sanitizeSubtitleText(lines.slice(timingIndex + 1).join('\n'));
  if (!text) return null;
  return { id: `cue-${index + 1}`, start, end, text };
}

function detectFormat(text: string): SubtitleFormat {
  const head = text.slice(0, 200).trimStart();
  if (/^WEBVTT\b/i.test(head)) return 'vtt';
  return 'srt';
}

/**
 * Parse SRT or WebVTT without a DOM, so it can be unit tested and never
 * executes cue markup. Cue tags are stripped and text is decoded as plain text.
 */
export function parseSubtitles(
  content: string,
  requestedFormat: SubtitleFormat | 'auto' = 'auto',
): SubtitleParseResult {
  if (typeof content !== 'string' || !content.trim()) {
    throw new AppError('SUBTITLE_PARSE_ERROR', '字幕文件为空。');
  }
  if (content.length > 5_000_000) {
    throw new AppError('SUBTITLE_PARSE_ERROR', '字幕文件过大（超过 5 MB 文本上限）。');
  }
  const normalized = stripBom(content).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  const format = requestedFormat === 'auto' ? detectFormat(normalized) : requestedFormat;
  let body = normalized;
  if (format === 'vtt') {
    body = body.replace(/^WEBVTT[^\n]*\n?/i, '');
    // Drop metadata blocks that are not cues.
    body = body.replace(/(?:^|\n)(?:NOTE|STYLE|REGION)\b[\s\S]*?(?=\n{2,}|$)/g, '\n');
  }
  const warnings: string[] = [];
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const cues: ParsedSubtitleCue[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.startsWith('WEBVTT')) continue;
    try {
      const cue = parseBlock(block, cues.length);
      if (cue) cues.push(cue);
      else if (block.includes('-->')) warnings.push(`第 ${index + 1} 个字幕块时间轴无效，已跳过。`);
    } catch {
      warnings.push(`第 ${index + 1} 个字幕块无法解析，已跳过。`);
    }
  }
  if (cues.length === 0) {
    throw new AppError('SUBTITLE_PARSE_ERROR', '没有解析出有效字幕。请确认文件是标准 SRT 或 WebVTT 格式。');
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  const limited = cues.slice(0, SUBTITLE_MAX_CUES);
  if (cues.length > SUBTITLE_MAX_CUES) {
    warnings.push(`字幕超过 ${SUBTITLE_MAX_CUES} 条，已截断。`);
  }
  return { format, cues: limited, warnings };
}

export function formatSubtitleTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}