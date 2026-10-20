export type ApiProtocol = 'openai-chat' | 'openai-audio';

export type TaskKind = 'webpage' | 'quality' | 'subtitles' | 'asr';

export const TASK_KINDS: readonly TaskKind[] = ['webpage', 'quality', 'subtitles', 'asr'];

export type TranslationStyle =
  | 'natural'
  | 'accurate'
  | 'formal'
  | 'casual'
  | 'technical';

export type SubtitleDisplayMode = 'translated' | 'original' | 'bilingual';
export type SubtitleSourceKind = 'native' | 'file' | 'asr';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface GlossaryEntry {
  id: string;
  source: string;
  target: string;
  caseSensitive: boolean;
}

export interface ModelConfig {
  id: string;
  name: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  protocol: ApiProtocol;
  modelId: string;
  headers: Record<string, string>;
  params: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ModelConfigInput = Omit<ModelConfig, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};

export interface PublicModelInfo {
  id: string;
  name: string;
  providerName: string;
  protocol: ApiProtocol;
  modelId: string;
  enabled: boolean;
}

export interface LanguagePrefs {
  source: string;
  target: string;
}

export interface TranslationPrefs {
  style: TranslationStyle;
  customPrompt: string;
  context: string;
  glossary: GlossaryEntry[];
  useGlossary: boolean;
}

export interface SubtitleStylePrefs {
  mode: SubtitleDisplayMode;
  fontSize: number;
  color: string;
  backgroundOpacity: number;
  bottomOffset: number;
  lineHeight: number;
  maxWidth: number;
}

export interface SubtitlePrefs {
  enabled: boolean;
  style: SubtitleStylePrefs;
}

export interface UiPrefs {
  theme: ThemePreference;
  autoTranslateNewContent: boolean;
  selectionEnabled: boolean;
}

export interface CachePrefs {
  maxEntries: number;
}

export interface UserPrefs {
  languages: LanguagePrefs;
  translation: TranslationPrefs;
  subtitle: SubtitlePrefs;
  ui: UiPrefs;
  cache: CachePrefs;
}

export interface Settings extends UserPrefs {
  schemaVersion: number;
  models: ModelConfig[];
  defaultModelId: string | null;
  taskModels: Record<TaskKind, string | null>;
}

export interface PublicSettings {
  schemaVersion: number;
  models: PublicModelInfo[];
  defaultModelId: string | null;
  taskModels: Record<TaskKind, string | null>;
  languages: LanguagePrefs;
  translation: {
    style: TranslationStyle;
    glossaryCount: number;
    customPromptEnabled: boolean;
  };
  subtitle: SubtitlePrefs;
  ui: UiPrefs;
  cache: CachePrefs;
}

export interface AppErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
  diagnostic?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape };

export interface TranslateBatchRequest {
  requestId: string;
  task: TaskKind;
  chunks: string[];
  modelId?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  style?: TranslationStyle;
  customPrompt?: string;
  context?: string;
  bypassCache?: boolean;
}

export interface TranslateBatchData {
  translations: string[];
  modelId: string;
  modelName: string;
  cachedCount: number;
}

export type PageTranslationStatus =
  | 'idle'
  | 'translating'
  | 'paused'
  | 'done'
  | 'error'
  | 'restored';

export type PageTranslationMode = 'replace' | 'bilingual';

export interface PageState {
  status: PageTranslationStatus;
  mode: PageTranslationMode;
  active: boolean;
  paused: boolean;
  total: number;
  completed: number;
  failed: number;
  message?: string;
  error?: AppErrorShape;
  canRetry: boolean;
  modelName?: string;
  autoTranslateNewContent: boolean;
  updatedAt: number;
}

export interface VideoInfo {
  id: string;
  label: string;
  width: number;
  height: number;
  duration: number;
  trackCount: number;
  selected: boolean;
}

export interface TrackInfo {
  index: number;
  label: string;
  language: string;
  kind: string;
  mode: TextTrackMode;
  cueCount: number;
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  original: string;
  translation?: string;
  status: 'pending' | 'translated' | 'failed';
}

export interface SubtitleState {
  enabled: boolean;
  panelOpen: boolean;
  videoCount: number;
  videos: VideoInfo[];
  selectedVideoId: string | null;
  tracks: TrackInfo[];
  selectedTrackIndex: number | null;
  source: SubtitleSourceKind | null;
  cues: SubtitleCue[];
  cueCount: number;
  translating: boolean;
  asrRunning: boolean;
  translatedCount: number;
  style: SubtitleStylePrefs;
  failedCount: number;
  message?: string;
  error?: AppErrorShape;
  mode: SubtitleDisplayMode;
  canUseAsr: boolean;
  asrNote?: string;
  updatedAt: number;
}

export interface ContentPageSnapshot {
  page: PageState;
  subtitle: SubtitleState;
  url: string;
  title: string;
}

export interface ActiveTabState {
  supported: boolean;
  tabId: number | null;
  url: string;
  title: string;
  page: PageState | null;
  subtitle: SubtitleState | null;
  reason?: string;
}

export interface CacheStats {
  entries: number;
  approxBytes: number;
  maxEntries: number;
}

export interface TestModelResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  model: string;
  code?: string;
}

export interface AsrTranscription {
  text: string;
  language?: string;
  duration?: number;
}

export interface SubtitleTranslationRequest {
  requestId: string;
  cues: Array<{ id: string; text: string }>;
  sourceLanguage?: string;
  targetLanguage?: string;
  modelId?: string;
  bypassCache?: boolean;
}