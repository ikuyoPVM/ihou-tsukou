import type { SubtitleCue } from '../shared/types';

export function groupCuesForTranslation(
  cues: SubtitleCue[],
  maxItems = 24,
  maxChars = 2800,
): SubtitleCue[][] {
  const groups: SubtitleCue[][] = [];
  let current: SubtitleCue[] = [];
  let chars = 0;
  for (const cue of cues) {
    if (
      current.length > 0 &&
      (current.length >= maxItems || chars + cue.original.length > maxChars)
    ) {
      groups.push(current);
      current = [];
      chars = 0;
    }
    current.push(cue);
    chars += cue.original.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function applySubtitleTranslations(
  cues: SubtitleCue[],
  translations: Array<{ id: string; text: string }>,
): SubtitleCue[] {
  const byId = new Map(translations.map((entry) => [entry.id, entry.text]));
  return cues.map((cue) => {
    const translation = byId.get(cue.id)?.trim();
    if (!translation) return cue;
    return {
      ...cue,
      translation,
      status: 'translated',
    };
  });
}

export function countSubtitleProgress(cues: SubtitleCue[]): {
  translated: number;
  failed: number;
  pending: number;
} {
  let translated = 0;
  let failed = 0;
  let pending = 0;
  for (const cue of cues) {
    if (cue.status === 'translated' && cue.translation) translated += 1;
    else if (cue.status === 'failed') failed += 1;
    else pending += 1;
  }
  return { translated, failed, pending };
}