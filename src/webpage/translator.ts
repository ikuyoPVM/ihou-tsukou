import { TRANSLATION_CONCURRENCY } from '../shared/constants';
import { AppError, normalizeError } from '../shared/errors';
import type { AppErrorShape, PageState, PageTranslationMode, PublicSettings } from '../shared/types';
import { createId } from '../shared/utils';
import {
  collectTextUnits,
  injectPageStyles,
  makePageTextUnit,
  removePageStyles,
  removeTranslationSpans,
  type PageTextUnit,
} from './extract';

interface TextRecord {
  node: Text;
  original: string;
  core: string;
  leading: string;
  trailing: string;
  status: 'pending' | 'queued' | 'translating' | 'translated' | 'failed';
  translation?: string;
  span?: HTMLSpanElement;
  renderedText: string;
}

export interface PageTranslateOutput {
  translations: string[];
  modelName: string;
}

export interface PageTranslatorDeps {
  translate: (
    chunks: string[],
    options: { requestId: string; bypassCache: boolean },
  ) => Promise<PageTranslateOutput>;
  cancel: (requestId: string) => void;
  onState: (state: PageState) => void;
}

interface BatchJob {
  records: TextRecord[];
  bypassCache: boolean;
}

const MAX_UNITS = 10_000;
const JOB_MAX_ITEMS = 8;
const JOB_MAX_CHARS = 3000;

export class PageTranslator {
  private records = new Map<Text, TextRecord>();
  private queue: BatchJob[] = [];
  private roots = new Set<Node>();
  private observer: MutationObserver | null = null;
  private activeRequestIds = new Set<string>();
  private processing = new Set<TextRecord>();
  private workers = 0;
  private generation = 0;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private settings: PublicSettings | null = null;
  private disposed = false;

  private active = false;
  private paused = false;
  private status: PageState['status'] = 'idle';
  private mode: PageTranslationMode = 'replace';
  private total = 0;
  private completed = 0;
  private failed = 0;
  private lastError: AppErrorShape | null = null;
  private lastMessage: string | undefined;
  private modelName: string | undefined;

  constructor(
    private readonly doc: Document,
    private readonly deps: PageTranslatorDeps,
  ) {}

  setSettings(settings: PublicSettings): void {
    this.settings = settings;
    this.emit();
  }

  getState(): PageState {
    return {
      status: this.status,
      mode: this.mode,
      active: this.active,
      paused: this.paused,
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      ...(this.lastMessage ? { message: this.lastMessage } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
      canRetry: this.failed > 0,
      ...(this.modelName ? { modelName: this.modelName } : {}),
      autoTranslateNewContent: this.settings?.ui.autoTranslateNewContent ?? true,
      updatedAt: Date.now(),
    };
  }

  start(mode: PageTranslationMode = 'replace', bypassCache = false): void {
    if (this.disposed) return;
    if (this.active && !this.paused) {
      if (this.mode !== mode) {
        this.mode = mode;
        this.renderAll();
      }
      if (this.status === 'done' || this.status === 'error') {
        this.scanAll();
        const pending = [...this.records.values()].filter((record) => record.status === 'pending');
        if (pending.length > 0) {
          this.status = 'translating';
          this.lastMessage = undefined;
          this.enqueueRecords(pending, bypassCache);
        }
      }
      this.emit();
      return;
    }
    if (this.active && this.paused) {
      this.mode = mode;
      this.resume();
      return;
    }
    this.resetSession();
    this.active = true;
    this.paused = false;
    this.status = 'translating';
    this.mode = mode;
    this.lastError = null;
    this.lastMessage = undefined;
    try {
      injectPageStyles(this.doc);
    } catch {
      // Styling failure should not stop translation.
    }
    this.attachObserver();
    this.scanAll();
    if (this.total === 0) {
      this.status = 'done';
      this.lastMessage = '没有找到适合翻译的文本。';
      this.emit();
      return;
    }
    this.enqueuePending(bypassCache);
    this.emit();
  }

  pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    this.status = 'paused';
    this.generation += 1;
    this.queue = [];
    for (const record of this.records.values()) {
      if (record.status === 'queued' || record.status === 'translating') {
        record.status = 'pending';
      }
    }
    for (const requestId of this.activeRequestIds) this.deps.cancel(requestId);
    this.activeRequestIds.clear();
    this.emit();
  }

  resume(): void {
    if (!this.active) {
      this.start(this.mode);
      return;
    }
    this.paused = false;
    this.status = 'translating';
    this.scanAll();
    this.enqueuePending(false);
    this.emit();
  }

  restore(): void {
    this.generation += 1;
    for (const requestId of this.activeRequestIds) this.deps.cancel(requestId);
    this.activeRequestIds.clear();
    this.queue = [];
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanTimer !== null) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    for (const record of this.records.values()) this.restoreRecord(record);
    removeTranslationSpans(this.doc);
    this.records.clear();
    this.processing.clear();
    this.roots.clear();
    removePageStyles(this.doc);
    this.active = false;
    this.paused = false;
    this.mode = 'replace';
    this.status = 'restored';
    this.total = 0;
    this.completed = 0;
    this.failed = 0;
    this.lastError = null;
    this.lastMessage = '已恢复原文。';
    this.modelName = undefined;
    this.emit();
  }

  retranslate(mode: PageTranslationMode = this.mode): void {
    this.restore();
    this.start(mode, true);
  }

  retryFailed(): void {
    if (!this.active || this.paused) return;
    const failedRecords = [...this.records.values()].filter((record) => record.status === 'failed');
    if (failedRecords.length === 0) return;
    this.failed = Math.max(0, this.failed - failedRecords.length);
    for (const record of failedRecords) record.status = 'pending';
    this.lastMessage = undefined;
    this.status = 'translating';
    this.enqueueRecords(failedRecords, false);
    this.emit();
  }

  setMode(mode: PageTranslationMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.active) this.renderAll();
    this.emit();
  }

  setAutoTranslateNewContent(enabled: boolean): void {
    if (!this.settings) return;
    this.settings = {
      ...this.settings,
      ui: { ...this.settings.ui, autoTranslateNewContent: enabled },
    };
    this.emit();
  }

  /** Synchronously drain pending mutation roots. Exposed for deterministic tests. */
  scanNow(): void {
    if (this.scanTimer !== null) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.flushRoots();
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanTimer !== null) clearTimeout(this.scanTimer);
    this.activeRequestIds.clear();
    this.queue = [];
    this.records.clear();
  }

  private resetSession(): void {
    this.generation += 1;
    this.queue = [];
    this.records.clear();
    this.processing.clear();
    this.roots.clear();
    this.total = 0;
    this.completed = 0;
    this.failed = 0;
  }

  private attachObserver(): void {
    if (this.observer || !this.doc.body) return;
    this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
    this.observer.observe(this.doc.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private handleMutations(mutations: MutationRecord[]): void {
    if (!this.active || this.paused || !this.settings?.ui.autoTranslateNewContent) return;
    let changed = false;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const node = mutation.target as Text;
        const record = this.records.get(node);
        if (!record) {
          this.roots.add(node);
          changed = true;
        } else if (node.nodeValue !== record.renderedText) {
          this.resetRecordForNewText(record);
          this.roots.add(node);
          changed = true;
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (isExtensionOwnedNode(node)) continue;
        this.roots.add(node);
        changed = true;
      }
    }
    if (changed) this.scheduleScan();
  }

  private scheduleScan(): void {
    if (this.scanTimer !== null) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.flushRoots();
    }, 350);
  }

  private flushRoots(): void {
    if (!this.active || this.paused || !this.settings?.ui.autoTranslateNewContent) {
      this.roots.clear();
      return;
    }
    this.pruneDisconnected();
    const units: PageTextUnit[] = [];
    for (const root of this.roots) {
      if (!root.isConnected) continue;
      if (root.nodeType === Node.TEXT_NODE) {
        const unit = makePageTextUnit(root as Text);
        if (unit) units.push(unit);
      } else {
        units.push(...collectTextUnits(root, { maxUnits: MAX_UNITS }));
      }
    }
    this.roots.clear();
    const newRecords: TextRecord[] = [];
    for (const unit of units) {
      const existing = this.records.get(unit.node);
      if (existing) {
        if (unit.original !== existing.original) {
          this.resetRecordForNewText(existing);
        }
        // A characterData mutation may already have reset the record to
        // pending before this batched scan runs. Re-enqueue pending records
        // even when the reset made original === unit.original.
        if (existing.status === 'pending' && !newRecords.includes(existing)) {
          newRecords.push(existing);
        }
        continue;
      }
      const record = this.createRecord(unit);
      this.records.set(unit.node, record);
      this.total += 1;
      newRecords.push(record);
    }
    if (newRecords.length > 0) {
      this.status = 'translating';
      this.lastMessage = undefined;
      this.enqueueRecords(newRecords, false);
      this.emit();
    }
  }

  private resetRecordForNewText(record: TextRecord): void {
    if (record.status === 'translated') this.completed = Math.max(0, this.completed - 1);
    if (record.status === 'failed') this.failed = Math.max(0, this.failed - 1);
    this.removeSpan(record);
    const unit = makePageTextUnit(record.node);
    if (!unit) {
      this.records.delete(record.node);
      this.total = Math.max(0, this.total - 1);
      return;
    }
    record.original = unit.original;
    record.core = unit.core;
    record.leading = unit.leading;
    record.trailing = unit.trailing;
    record.renderedText = unit.original;
    record.translation = undefined;
    record.status = 'pending';
  }

  private scanAll(): void {
    if (!this.doc.body) return;
    const units = collectTextUnits(this.doc.body, {
      maxUnits: MAX_UNITS,
      exclude: new Set(this.records.keys()),
    });
    for (const unit of units) {
      if (this.records.has(unit.node)) continue;
      const record = this.createRecord(unit);
      this.records.set(unit.node, record);
      this.total += 1;
    }
    if (units.length >= MAX_UNITS) {
      this.lastMessage = `页面文本较多，首轮最多处理 ${MAX_UNITS} 个文本节点。`;
    }
  }

  private createRecord(unit: PageTextUnit): TextRecord {
    return {
      node: unit.node,
      original: unit.original,
      core: unit.core,
      leading: unit.leading,
      trailing: unit.trailing,
      status: 'pending',
      renderedText: unit.original,
    };
  }

  private enqueuePending(bypassCache: boolean): void {
    const pending = [...this.records.values()].filter((record) => record.status === 'pending');
    this.enqueueRecords(pending, bypassCache);
  }

  private enqueueRecords(records: TextRecord[], bypassCache: boolean): void {
    if (records.length === 0) return;
    let current: TextRecord[] = [];
    let chars = 0;
    const jobs: BatchJob[] = [];
    for (const record of records) {
      if (record.status !== 'pending') continue;
      if (
        current.length > 0 &&
        (current.length >= JOB_MAX_ITEMS || chars + record.core.length > JOB_MAX_CHARS)
      ) {
        jobs.push({ records: current, bypassCache });
        current = [];
        chars = 0;
      }
      record.status = 'queued';
      current.push(record);
      chars += record.core.length;
    }
    if (current.length > 0) jobs.push({ records: current, bypassCache });
    this.queue.push(...jobs);
    this.pump();
  }

  private pump(): void {
    if (!this.active || this.paused) return;
    while (this.workers < TRANSLATION_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.workers += 1;
      const generation = this.generation;
      for (const record of job.records) {
        record.status = 'translating';
        this.processing.add(record);
      }
      void this.processJob(job, generation).finally(() => {
        this.workers = Math.max(0, this.workers - 1);
        this.pump();
        this.finishIfIdle();
      });
    }
    this.finishIfIdle();
  }

  private async processJob(job: BatchJob, generation: number): Promise<void> {
    if (job.records.length === 0) return;
    const requestId = createId('page');
    this.activeRequestIds.add(requestId);
    try {
      const result = await this.deps.translate(
        job.records.map((record) => record.core),
        { requestId, bypassCache: job.bypassCache },
      );
      if (generation !== this.generation || !this.active || this.paused) return;
      if (result.translations.length !== job.records.length) {
        throw new AppError('INVALID_RESPONSE', '翻译结果数量与页面段落数量不一致。');
      }
      result.translations.forEach((translation, index) => {
        const record = job.records[index];
        if (!record || record.status !== 'translating') return;
        if (!record.node.isConnected) {
          record.status = 'failed';
          this.failed += 1;
          return;
        }
        const text = translation.trim();
        if (!text) {
          record.status = 'failed';
          this.failed += 1;
          return;
        }
        record.translation = text;
        record.status = 'translated';
        this.completed += 1;
        this.renderRecord(record);
      });
      this.modelName = result.modelName || this.modelName;
    } catch (error) {
      if (generation !== this.generation || !this.active || this.paused) return;
      const normalized = normalizeError(error);
      if (normalized.code === 'CANCELLED') return;
      this.lastError = normalized.toShape();
      for (const record of job.records) {
        if (record.status === 'translating') {
          record.status = 'failed';
          this.failed += 1;
        }
      }
      this.lastMessage = `部分段落翻译失败：${normalized.message}`;
    } finally {
      this.activeRequestIds.delete(requestId);
      for (const record of job.records) this.processing.delete(record);
      this.emit();
    }
  }

  private finishIfIdle(): void {
    if (!this.active || this.paused) return;
    if (this.queue.length > 0 || this.workers > 0) return;
    if (this.status === 'translating') {
      if (this.completed === 0 && this.failed > 0) {
        this.status = 'error';
        this.lastMessage = this.lastError?.message ?? '翻译失败。';
      } else {
        this.status = 'done';
        this.lastMessage =
          this.failed > 0
            ? `翻译完成，${this.failed} 段失败，可点击“重试失败段落”。`
            : `翻译完成，共 ${this.completed} 段。`;
        if (this.failed === 0) this.lastError = null;
      }
      this.emit();
    }
  }

  private renderAll(): void {
    for (const record of this.records.values()) {
      if (record.status === 'translated') {
        if (this.mode === 'bilingual') this.renderRecord(record);
        else this.renderRecord(record);
      }
    }
  }

  private renderRecord(record: TextRecord): void {
    if (!record.node.isConnected || record.translation === undefined) return;
    if (this.mode === 'replace') {
      this.removeSpan(record);
      const rendered = `${record.leading}${record.translation}${record.trailing}`;
      record.node.nodeValue = rendered;
      record.renderedText = rendered;
      return;
    }
    record.node.nodeValue = record.original;
    record.renderedText = record.original;
    this.removeSpan(record);
    const span = this.doc.createElement('span');
    span.setAttribute('data-ihou-tsukou', 'translation');
    span.setAttribute('lang', this.settings?.languages.target ?? 'zh-CN');
    span.setAttribute('dir', 'auto');
    span.textContent = record.translation;
    const parent = record.node.parentNode;
    if (!parent) return;
    parent.insertBefore(span, record.node.nextSibling);
    record.span = span;
  }

  private removeSpan(record: TextRecord): void {
    if (record.span?.isConnected) record.span.remove();
    record.span = undefined;
  }

  private restoreRecord(record: TextRecord): void {
    this.removeSpan(record);
    if (record.node.isConnected) record.node.nodeValue = record.original;
  }

  private pruneDisconnected(): void {
    for (const [node, record] of this.records) {
      if (node.isConnected) continue;
      this.removeSpan(record);
      this.records.delete(node);
      this.total = Math.max(0, this.total - 1);
      if (record.status === 'translated') this.completed = Math.max(0, this.completed - 1);
      if (record.status === 'failed') this.failed = Math.max(0, this.failed - 1);
    }
  }

  private emit(): void {
    this.deps.onState(this.getState());
  }
}

function isExtensionOwnedNode(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    if (element.matches('[data-ihou-tsukou], .ihou-tsukou-ui')) return true;
    if (element.closest?.('[data-ihou-tsukou], .ihou-tsukou-ui')) return true;
  } else if (node.parentElement) {
    if (node.parentElement.closest('[data-ihou-tsukou], .ihou-tsukou-ui')) return true;
  }
  return false;
}