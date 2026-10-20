import type { CSSProperties } from 'react';
import type { SubtitleOverlayData } from '../../subtitles/controller';

function overlayPosition(overlay: SubtitleOverlayData): CSSProperties {
  const width = Math.max(
    200,
    Math.min(
      window.innerWidth - 24,
      overlay.rect.width * (Math.max(40, Math.min(100, overlay.style.maxWidth)) / 100),
    ),
  );
  const centered = overlay.rect.left + (overlay.rect.width - width) / 2;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, centered));
  const bottomOffset = overlay.rect.height * (overlay.style.bottomOffset / 100);
  const bottom = Math.max(8, window.innerHeight - overlay.rect.bottom + bottomOffset);
  return {
    left,
    width,
    bottom,
    fontSize: `${overlay.style.fontSize}px`,
    lineHeight: overlay.style.lineHeight,
    ['--pgp-subtitle-opacity' as string]: String(overlay.style.backgroundOpacity),
    ['--pgp-subtitle-color' as string]: overlay.style.color,
  };
}

export function SubtitleOverlay({ overlay }: { overlay: SubtitleOverlayData | null }) {
  if (!overlay || overlay.cues.length === 0) return null;
  const { rect } = overlay;
  const offscreen =
    rect.bottom <= 0 ||
    rect.top >= window.innerHeight ||
    rect.left + rect.width <= 0 ||
    rect.left >= window.innerWidth;
  if (offscreen) return null;
  const showOriginal = overlay.mode !== 'translated';
  const showTranslation = overlay.mode !== 'original';
  return (
    <div className="pgp-subtitle-layer" style={overlayPosition(overlay)} lang={overlay.targetLanguage}>
      {overlay.cues.map((cue) => {
        const translated = cue.translation?.trim();
        return (
          <div className="pgp-subtitle-box" key={cue.key}>
            {showOriginal && <div className="pgp-subtitle-original">{cue.original}</div>}
            {showTranslation && translated && (
              <div className="pgp-subtitle-translation">{translated}</div>
            )}
            {!showOriginal && !translated && (
              <div className="pgp-subtitle-original">{cue.original}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}