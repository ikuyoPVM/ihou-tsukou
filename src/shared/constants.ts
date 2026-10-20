import type { LanguagePrefs, SubtitleStylePrefs, TranslationStyle } from './types';

export const STORAGE_KEY = 'ihou:settings:v1';
// Read-only fallback for users upgrading from the pre-rename build.
export const LEGACY_STORAGE_KEY = 'polyglot:settings:v1';
export const CACHE_STORAGE_KEY = 'ihou:cache:v1';
export const LEGACY_CACHE_STORAGE_KEY = 'polyglot:cache:v1';
export const TAB_STATE_PREFIX = 'ihou:tab:';
export const SETTINGS_SCHEMA_VERSION = 1;

export const DEFAULT_LANGUAGES: LanguagePrefs = {
  source: 'auto',
  target: 'zh-CN',
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStylePrefs = {
  mode: 'bilingual',
  fontSize: 22,
  color: '#ffffff',
  backgroundOpacity: 0.62,
  bottomOffset: 6,
  lineHeight: 1.38,
  maxWidth: 88,
};

export const SOURCE_LANGUAGES = [
  { code: 'auto', label: '自动检测' },
  { code: 'en', label: '英语' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁体中文' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'ru', label: '俄语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'it', label: '意大利语' },
  { code: 'ar', label: '阿拉伯语' },
  { code: 'hi', label: '印地语' },
  { code: 'th', label: '泰语' },
  { code: 'vi', label: '越南语' },
  { code: 'tr', label: '土耳其语' },
  { code: 'id', label: '印度尼西亚语' },
  { code: 'nl', label: '荷兰语' },
  { code: 'pl', label: '波兰语' },
] as const;

export const TARGET_LANGUAGES = SOURCE_LANGUAGES.filter((language) => language.code !== 'auto');

export const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  [...SOURCE_LANGUAGES, { code: 'uk', label: '乌克兰语' }, { code: 'fa', label: '波斯语' }].map(
    (language) => [language.code, language.label],
  ),
);

export const TRANSLATION_STYLES: ReadonlyArray<{
  value: TranslationStyle;
  label: string;
  hint: string;
}> = [
  { value: 'natural', label: '自然', hint: '通顺、贴近母语表达' },
  { value: 'accurate', label: '准确', hint: '严格对应原文，少改写' },
  { value: 'formal', label: '正式', hint: '适合公文、新闻、商务' },
  { value: 'casual', label: '口语', hint: '轻松、适合对话与社交内容' },
  { value: 'technical', label: '技术文档', hint: '术语一致，保留结构' },
];

export const TASK_LABELS: Record<string, string> = {
  webpage: '网页翻译',
  quality: '高质量翻译',
  subtitles: '视频字幕翻译',
  asr: '语音识别',
};

export const MAX_SOURCE_TEXT_LENGTH = 8000;
export const MAX_BATCH_CHARS = 3600;
export const MAX_BATCH_ITEMS = 12;
export const TRANSLATION_CONCURRENCY = 2;
export const SUBTITLE_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const SUBTITLE_MAX_CUES = 6000;

export const DEFAULT_TIMEOUT_MS = 60_000;

export const REQUEST_HEADER_BLOCKLIST = new Set([
  'host',
  'content-length',
  'connection',
  'cookie',
  'origin',
  'referer',
]);

export const SUPPORTED_PAGE_PROTOCOLS = new Set(['http:', 'https:']);