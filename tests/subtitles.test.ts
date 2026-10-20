import { describe, expect, it } from 'vitest';
import {
  formatSubtitleTimestamp,
  parseSubtitles,
  sanitizeSubtitleText,
} from '../src/subtitles/parser';
import { findActiveCues, timeAfterPlayback } from '../src/subtitles/timeline';
import {
  applySubtitleTranslations,
  countSubtitleProgress,
  groupCuesForTranslation,
} from '../src/subtitles/translator';
import type { SubtitleCue } from '../src/shared/types';

const SRT = `1
00:00:01,000 --> 00:00:02,500
Hello <i>world</i> &amp; friends

2
00:00:03,000 --> 00:00:04,000
Second line<br>next line
`;

const VTT = `WEBVTT - test

NOTE this is a comment

cue-a
00:00:01.000 --> 00:00:02.000 align:start position:10%
<v Speaker>Hello &lt;there&gt;</v>

00:03.500 --> 00:05.000
第二行
`;

function cues(): SubtitleCue[] {
  return [
    { id: 'a', start: 0, end: 2, original: 'A', status: 'pending' },
    { id: 'b', start: 1, end: 4, original: 'B', status: 'pending' },
    { id: 'c', start: 5, end: 6, original: 'C', status: 'pending' },
  ];
}

describe('SRT/VTT parser', () => {
  it('parses SRT, strips markup, decodes entities and preserves timeline', () => {
    const result = parseSubtitles(SRT, 'srt');
    expect(result.format).toBe('srt');
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0]).toMatchObject({ start: 1, end: 2.5, text: 'Hello world & friends' });
    expect(result.cues[1]?.text).toBe('Second line\nnext line');
  });

  it('auto-detects WebVTT, ignores NOTE blocks and supports mm:ss timestamps', () => {
    const result = parseSubtitles(VTT);
    expect(result.format).toBe('vtt');
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0]?.text).toContain('Hello <there>');
    expect(result.cues[1]).toMatchObject({ start: 3.5, end: 5, text: '第二行' });
  });

  it('rejects empty, invalid and unparseable files with a typed error', () => {
    expect(() => parseSubtitles('   ')).toThrow(
      expect.objectContaining({ code: 'SUBTITLE_PARSE_ERROR' }),
    );
    expect(() => parseSubtitles('1\nnot a timestamp\nhello', 'srt')).toThrow(
      expect.objectContaining({ code: 'SUBTITLE_PARSE_ERROR' }),
    );
  });

  it('skips malformed blocks while keeping valid ones and records warnings', () => {
    const result = parseSubtitles(
      `1
00:00:01,000 --> 00:00:02,000
Valid

2
00:00:05,000 --> 00:00:01,000
Reversed

3
99:99:99,000 --> 00:00:02,000
Bad
`,
      'srt',
    );
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0]?.text).toBe('Valid');
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('never returns HTML as markup and caps cue text', () => {
    const dangerous = sanitizeSubtitleText('<img src=x onerror=alert(1)>Hi &lt;script&gt;');
    expect(dangerous).toBe('Hi <script>');
    expect(sanitizeSubtitleText('x'.repeat(6000))).toHaveLength(5000);
  });

  it('formats timestamps safely', () => {
    expect(formatSubtitleTimestamp(3661.5)).toBe('01:01:01.500');
    expect(formatSubtitleTimestamp(-3)).toBe('00:00:00.000');
  });
});

describe('subtitle timeline', () => {
  it('finds overlapping cues by binary search at exact boundaries', () => {
    const list = cues();
    expect(findActiveCues(list, 0)).toEqual([list[0]]);
    expect(findActiveCues(list, 1.5)).toEqual([list[0], list[1]]);
    expect(findActiveCues(list, 2)).toEqual([list[1]]);
    expect(findActiveCues(list, 4)).toEqual([]);
    expect(findActiveCues(list, 5.5)).toEqual([list[2]]);
    expect(findActiveCues([], 1)).toEqual([]);
  });

  it('does not drift at 0.5x, 1x and 2x playback rates', () => {
    const list = cues();
    for (const rate of [0.5, 1, 1.5, 2]) {
      const time = timeAfterPlayback(0, 3, rate);
      const active = findActiveCues(list, time);
      expect(active.every((cue) => cue.start <= time && cue.end > time)).toBe(true);
    }
    expect(timeAfterPlayback(2, 4, 0.5)).toBe(4);
    expect(timeAfterPlayback(2, 4, 2)).toBe(10);
    expect(timeAfterPlayback(2, 4, Number.NaN)).toBe(6);
  });
});

describe('subtitle translation grouping', () => {
  it('groups by item count and character budget', () => {
    const list = cues();
    expect(groupCuesForTranslation(list, 2, 1000).map((group) => group.length)).toEqual([2, 1]);
    const long = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      start: index,
      end: index + 1,
      original: 'x'.repeat(40),
      status: 'pending' as const,
    }));
    expect(groupCuesForTranslation(long, 24, 100).length).toBe(3);
  });

  it('applies translations by id, preserves failures and counts progress', () => {
    const list = cues();
    const updated = applySubtitleTranslations(list, [
      { id: 'a', text: '译 A' },
      { id: 'c', text: '   ' },
    ]);
    expect(updated[0]).toMatchObject({ translation: '译 A', status: 'translated' });
    expect(updated[1]?.status).toBe('pending');
    expect(updated[2]?.status).toBe('pending');

    const failed = [{ ...list[1]!, status: 'failed' as const }, updated[0]!, updated[2]!];
    expect(countSubtitleProgress(failed)).toEqual({ translated: 1, failed: 1, pending: 1 });
  });
});