import {
  DEFAULT_LANGUAGES,
  DEFAULT_SUBTITLE_STYLE,
  SETTINGS_SCHEMA_VERSION,
} from '../shared/constants';
import type { Settings } from '../shared/types';

export function createDefaultSettings(): Settings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    models: [],
    defaultModelId: null,
    taskModels: {
      webpage: null,
      quality: null,
      subtitles: null,
      asr: null,
    },
    languages: { ...DEFAULT_LANGUAGES },
    translation: {
      style: 'natural',
      customPrompt: '',
      context: '',
      glossary: [],
      useGlossary: true,
    },
    subtitle: {
      enabled: false,
      style: { ...DEFAULT_SUBTITLE_STYLE },
    },
    ui: {
      theme: 'system',
      autoTranslateNewContent: true,
      selectionEnabled: true,
    },
    cache: {
      maxEntries: 1500,
    },
  };
}