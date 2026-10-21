import { useSyncExternalStore } from 'react';
import type {
  PageState,
  PageTranslationMode,
  PublicModelInfo,
  SubtitleDisplayMode,
  SubtitleState,
  SubtitleStylePrefs,
} from '../../shared/types';
import type { SubtitleOverlayData } from '../../subtitles/controller';

export interface SelectionTriggerView {
  left: number;
  top: number;
}

export interface SelectionView {
  rect: { left: number; top: number; width: number; height: number };
  source: string;
  sourceLanguage: string;
  targetLanguage: string;
  status: 'loading' | 'done' | 'error';
  translation?: string;
  error?: string;
}

export interface ToastView {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export interface UiState {
  theme: 'light' | 'dark';
  trigger: SelectionTriggerView | null;
  selection: SelectionView | null;
  overlay: SubtitleOverlayData | null;
  subtitleState: SubtitleState | null;
  pageState: PageState | null;
  panelOpen: boolean;
  quickOpen: boolean;
  quickMode: PageTranslationMode;
  models: PublicModelInfo[];
  selectedModelId: string;
  busy: boolean;
  targetLanguage: string;
  toast: ToastView | null;
}

export interface UiActions {
  translateSelection(): void;
  retrySelection(): void;
  closeSelection(): void;
  copyText(text: string): void;
  toggleSubtitles(enabled: boolean): void;
  openPanel(open: boolean): void;
  openQuick(open: boolean): void;
  setQuickMode(mode: PageTranslationMode): void;
  startQuickTranslation(): void;
  pauseQuickTranslation(): void;
  resumeQuickTranslation(): void;
  restoreQuickTranslation(): void;
  retranslateQuickTranslation(): void;
  retryFailedQuickTranslation(): void;
  refreshVideos(): void;
  selectVideo(videoId: string): void;
  loadTrack(trackIndex: number): void;
  importFile(file: File): void;
  translateSubtitles(): void;
  retryFailedSubtitles(): void;
  stopSubtitles(): void;
  startAsr(): void;
  stopAsr(): void;
  setSubtitleMode(mode: SubtitleDisplayMode): void;
  updateSubtitleStyle(patch: Partial<SubtitleStylePrefs>): void;
  setSelectedModel(modelId: string): void;
  openOptions(): void;
}

export class UiStore {
  private state: UiState;
  private listeners = new Set<() => void>();

  constructor(initial: UiState) {
    this.state = initial;
  }

  getSnapshot = (): UiState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  get(): UiState {
    return this.state;
  }
}

export function useUiState(store: UiStore): UiState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function createInitialUiState(): UiState {
  return {
    theme: 'light',
    trigger: null,
    selection: null,
    overlay: null,
    subtitleState: null,
    pageState: null,
    panelOpen: false,
    quickOpen: false,
    quickMode: 'replace',
    models: [],
    selectedModelId: '',
    busy: false,
    targetLanguage: '简体中文',
    toast: null,
  };
}