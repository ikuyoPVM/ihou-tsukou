import { afterEach, describe, expect, it } from 'vitest';
import { SubtitleController, type SubtitleOverlayData } from '../src/subtitles/controller';
import { createDefaultSettings } from '../src/settings/defaults';
import type { PublicSettings, SubtitleCue } from '../src/shared/types';

const activeControllers: SubtitleController[] = [];

function publicSettings(withAudio = false): PublicSettings {
  const defaults = createDefaultSettings();
  return {
    schemaVersion: defaults.schemaVersion,
    models: [
      {
        id: 'chat_1',
        name: '字幕模型',
        providerName: 'Mock',
        protocol: 'openai-chat',
        modelId: 'mock-chat',
        enabled: true,
      },
      ...(withAudio
        ? [
            {
              id: 'audio_1',
              name: '语音模型',
              providerName: 'Mock',
              protocol: 'openai-audio' as const,
              modelId: 'mock-whisper',
              enabled: true,
            },
          ]
        : []),
    ],
    defaultModelId: 'chat_1',
    taskModels: { ...defaults.taskModels, subtitles: 'chat_1', asr: withAudio ? 'audio_1' : null },
    languages: { ...defaults.languages },
    translation: { style: defaults.translation.style, glossaryCount: 0, customPromptEnabled: false },
    subtitle: {
      enabled: false,
      style: { ...defaults.subtitle.style, mode: 'bilingual' },
    },
    ui: { ...defaults.ui },
    cache: { ...defaults.cache },
  };
}

function createVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
  Object.defineProperty(video, 'duration', { configurable: true, value: 30 });
  Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 1.2 });
  video.getBoundingClientRect = () =>
    ({ left: 20, top: 40, width: 640, height: 360, right: 660, bottom: 400, x: 20, y: 40, toJSON: () => ({}) }) as DOMRect;
  return video;
}

function createController(options: {
  settings?: PublicSettings;
  translate?: (cues: Array<{ id: string; text: string }>) => Promise<Array<{ id: string; text: string }>>;
} = {}) {
  const states: ReturnType<SubtitleController['getState']>[] = [];
  const overlays: Array<SubtitleOverlayData | null> = [];
  const settings = options.settings ?? publicSettings();
  const controller = new SubtitleController(document, {
    getSettings: () => settings,
    translate: async ({ cues }) => {
      const translated = options.translate
        ? await options.translate(cues)
        : cues.map((cue) => ({ id: cue.id, text: `译:${cue.text}` }));
      return { translations: translated, modelName: '字幕模型' };
    },
    cancel: () => undefined,
    transcribe: async () => 'mock transcript',
    onState: (state) => {
      states.push(state);
    },
    onOverlay: (data) => {
      overlays.push(data);
    },
  });
  activeControllers.push(controller);
  return { controller, states, overlays, settings };
}

const SRT = `1
00:00:01,000 --> 00:00:02,500
Hello

2
00:00:03,000 --> 00:00:04,000
World
`;

afterEach(() => {
  for (const controller of activeControllers.splice(0)) controller.dispose();
  document.body.innerHTML = '';
});

describe('SubtitleController source and translation flow', () => {
  it('reports no native captions clearly instead of pretending to work', async () => {
    document.body.appendChild(createVideo());
    const { controller, states } = createController();
    expect(controller.getState().videoCount).toBe(1);

    await controller.toggleEnabled(true);
    const state = controller.getState();
    expect(state.enabled).toBe(false);
    expect(state.panelOpen).toBe(true);
    expect(state.error?.code).toBe('SUBTITLE_NO_SOURCE');
    expect(states.length).toBeGreaterThan(0);
  });

  it('imports SRT, translates cues, keeps originals and renders the active overlay', async () => {
    const video = createVideo();
    document.body.appendChild(video);
    const { controller, overlays } = createController();

    controller.importSubtitleFile(SRT, 'movie.srt');
    let state = controller.getState();
    expect(state.enabled).toBe(true);
    expect(state.source).toBe('file');
    expect(state.cueCount).toBe(2);

    await controller.startTranslation();
    state = controller.getState();
    expect(state.translatedCount).toBe(2);
    const cues = controller.getCues();
    expect(cues[0]?.original).toBe('Hello');
    expect(cues[0]?.translation).toBe('译:Hello');

    const overlay = overlays.filter(Boolean).at(-1) as SubtitleOverlayData;
    expect(overlay.cues).toHaveLength(1);
    expect(overlay.cues[0]).toMatchObject({ original: 'Hello', translation: '译:Hello' });

    controller.setMode('translated');
    expect(controller.getState().mode).toBe('translated');
    expect((overlays.filter(Boolean).at(-1) as SubtitleOverlayData).mode).toBe('translated');

    controller.setMode('original');
    expect((overlays.filter(Boolean).at(-1) as SubtitleOverlayData).cues[0]).toMatchObject({
      original: 'Hello',
    });
  });

  it('preserves originals and reports failures when the translation API fails', async () => {
    document.body.appendChild(createVideo());
    const { controller } = createController({
      translate: async () => {
        throw new Error('mock API failure');
      },
    });
    controller.importSubtitleFile(SRT, 'movie.srt');
    await controller.startTranslation();
    const state = controller.getState();
    expect(state.translatedCount).toBe(0);
    expect(state.failedCount).toBe(2);
    expect(state.message).toContain('失败');
    const cues: SubtitleCue[] = controller.getCues();
    expect(cues.every((cue) => cue.original.length > 0)).toBe(true);
    expect(cues.every((cue) => !cue.translation)).toBe(true);
  });

  it('stops translating and keeps completed cues', async () => {
    document.body.appendChild(createVideo());
    let release: (() => void) | undefined;
    const { controller } = createController({
      translate: async (cues) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return cues.map((cue) => ({ id: cue.id, text: `译:${cue.text}` }));
      },
    });
    controller.importSubtitleFile(SRT, 'movie.srt');
    const operation = controller.startTranslation();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await controller.stopTranslation();
    release?.();
    await operation;
    const state = controller.getState();
    expect(state.translating).toBe(false);
    expect(state.translatedCount).toBe(0);
    expect(controller.getCues().every((cue) => !cue.translation)).toBe(true);
  });

  it('refuses ASR without an audio model and states the limitation', async () => {
    document.body.appendChild(createVideo());
    const { controller } = createController();
    await expect(controller.startAsr()).rejects.toMatchObject({ code: 'NO_MODEL' });
    const state = controller.getState();
    expect(state.canUseAsr).toBe(false);
    expect(state.asrNote).toContain('未配置语音识别模型');
  });

  it('rejects malformed imported subtitle files without enabling the overlay', () => {
    document.body.appendChild(createVideo());
    const { controller } = createController();
    expect(() => controller.importSubtitleFile('not a subtitle', 'bad.srt')).toThrow(
      expect.objectContaining({ code: 'SUBTITLE_PARSE_ERROR' }),
    );
    expect(controller.getState().enabled).toBe(false);
  });
});