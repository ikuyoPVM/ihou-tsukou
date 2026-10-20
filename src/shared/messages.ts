import type {
  ActiveTabState,
  ApiResult,
  AsrTranscription,
  CacheStats,
  ContentPageSnapshot,
  ModelConfig,
  ModelConfigInput,
  PageState,
  PublicSettings,
  Settings,
  SubtitlePrefs,
  SubtitleState,
  SubtitleTranslationRequest,
  TaskKind,
  TestModelResult,
  TranslateBatchData,
  TranslateBatchRequest,
  UserPrefs,
} from './types';

export type PrefsPatch = {
  languages?: Partial<UserPrefs['languages']>;
  translation?: Partial<UserPrefs['translation']>;
  subtitle?: Partial<UserPrefs['subtitle']>;
  cache?: Partial<UserPrefs['cache']>;
  ui?: Partial<UserPrefs['ui']>;
};

export type ContentCommand =
  | { type: 'page:start'; mode?: 'replace' | 'bilingual'; bypassCache?: boolean }
  | { type: 'page:pause' }
  | { type: 'page:resume' }
  | { type: 'page:restore' }
  | { type: 'page:retranslate'; mode?: 'replace' | 'bilingual' }
  | { type: 'page:retryFailed' }
  | { type: 'page:getState' }
  | { type: 'subtitles:getState' }
  | { type: 'subtitles:enable'; enabled: boolean }
  | { type: 'subtitles:openPanel' }
  | { type: 'subtitles:selectVideo'; videoId: string }
  | { type: 'subtitles:selectTrack'; trackIndex: number }
  | { type: 'subtitles:setMode'; mode: SubtitleState['mode'] }
  | { type: 'subtitles:loadFile'; text: string; filename: string }
  | { type: 'subtitles:translate'; modelId?: string }
  | { type: 'subtitles:stop' }
  | { type: 'subtitles:startAsr' }
  | { type: 'subtitles:applySubtitlePrefs'; style: Partial<SubtitlePrefs['style']> }
  | { type: 'ui:showPanel'; open: boolean };

export type RuntimeRequest =
  | { type: 'settings.getPublic' }
  | { type: 'settings.getFull' }
  | { type: 'settings.saveModel'; model: ModelConfigInput }
  | { type: 'settings.deleteModel'; id: string }
  | { type: 'settings.clearModelKey'; id: string }
  | { type: 'settings.duplicateModel'; id: string }
  | { type: 'settings.setDefaultModel'; id: string | null }
  | { type: 'settings.setTaskModel'; task: TaskKind; id: string | null }
  | { type: 'settings.updatePrefs'; patch: PrefsPatch }
  | { type: 'settings.updateSubtitlePrefs'; style: Partial<SubtitlePrefs['style']> }
  | { type: 'models.test'; modelId?: string; draft?: ModelConfigInput }
  | { type: 'models.list'; modelId?: string; draft?: ModelConfigInput }
  | { type: 'translate.batch'; request: TranslateBatchRequest }
  | { type: 'translate.cancel'; requestId: string }
  | { type: 'translate.subtitles'; request: SubtitleTranslationRequest }
  | { type: 'asr.transcribe'; audioBase64: string; mimeType: string; language?: string; modelId?: string }
  | { type: 'tab.getState' }
  | { type: 'tab.command'; command: ContentCommand }
  | { type: 'tab.stateReport'; page: PageState; subtitle: SubtitleState; url: string; title: string }
  | { type: 'cache.stats' }
  | { type: 'cache.clear' }
  | { type: 'data.clear' }
  | { type: 'app.getVersion' };

export interface RuntimeResponses {
  'settings.getPublic': PublicSettings;
  'settings.getFull': Settings;
  'settings.saveModel': ModelConfig;
  'settings.deleteModel': { deleted: boolean };
  'settings.clearModelKey': { cleared: true };
  'settings.duplicateModel': ModelConfig;
  'settings.setDefaultModel': { defaultModelId: string | null };
  'settings.setTaskModel': { taskModels: Record<TaskKind, string | null> };
  'settings.updatePrefs': PublicSettings;
  'settings.updateSubtitlePrefs': SubtitlePrefs;
  'models.test': TestModelResult;
  'models.list': { models: string[] };
  'translate.batch': TranslateBatchData;
  'translate.cancel': { cancelled: boolean };
  'translate.subtitles': TranslateBatchData;
  'asr.transcribe': AsrTranscription;
  'tab.getState': ActiveTabState;
  'tab.command': ContentPageSnapshot;
  'tab.stateReport': { stored: boolean };
  'cache.stats': CacheStats;
  'cache.clear': { cleared: number };
  'data.clear': { cleared: true };
  'app.getVersion': { version: string };
}

export type RuntimeResponse<T extends RuntimeRequest['type']> = ApiResult<RuntimeResponses[T]>;

export function isContentCommand(value: unknown): value is ContentCommand {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.includes(':')
  );
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}