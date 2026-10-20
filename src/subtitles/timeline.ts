export interface TimelineCue {
  start: number;
  end: number;
}

/**
 * Find every active cue at `time`. Cue lookup depends only on currentTime, not
 * on accumulated timers, so pause/seek/playbackRate cannot drift the timeline.
 */
export function findActiveCues<T extends TimelineCue>(cues: T[], time: number): T[] {
  if (!Number.isFinite(time) || cues.length === 0) return [];
  let low = 0;
  let high = cues.length - 1;
  let lastStarted = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (!cue) break;
    if (cue.start <= time) {
      lastStarted = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (lastStarted < 0) return [];
  const active: T[] = [];
  for (let index = lastStarted; index >= 0; index -= 1) {
    const cue = cues[index];
    if (!cue || cue.start > time) continue;
    if (cue.end > time) active.unshift(cue);
  }
  return active;
}

export function clampVideoTime(currentTime: number, duration: number): number {
  if (!Number.isFinite(currentTime)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, currentTime);
  return Math.min(Math.max(0, currentTime), duration);
}

/** Simulates playback to verify scheduling at arbitrary rates without wall-clock drift. */
export function timeAfterPlayback(start: number, elapsedSeconds: number, rate: number): number {
  return start + elapsedSeconds * (Number.isFinite(rate) ? Math.max(0.1, rate) : 1);
}