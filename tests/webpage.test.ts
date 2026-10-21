import { afterEach, describe, expect, it } from 'vitest';
import { collectTextUnits } from '../src/webpage/extract';
import { PageTranslator } from '../src/webpage/translator';
import { createDefaultSettings } from '../src/settings/defaults';
import type { PageState, PublicSettings } from '../src/shared/types';

function publicSettings(overrides: Partial<PublicSettings['ui']> = {}): PublicSettings {
  const defaults = createDefaultSettings();
  return {
    schemaVersion: defaults.schemaVersion,
    models: [
      {
        id: 'model_1',
        name: '测试模型',
        providerName: 'Mock',
        protocol: 'openai-chat',
        modelId: 'mock',
        enabled: true,
      },
    ],
    defaultModelId: 'model_1',
    taskModels: { ...defaults.taskModels, webpage: 'model_1' },
    languages: { ...defaults.languages },
    translation: { style: defaults.translation.style, glossaryCount: 0, customPromptEnabled: false },
    subtitle: { ...defaults.subtitle, style: { ...defaults.subtitle.style } },
    ui: { ...defaults.ui, ...overrides },
    cache: { ...defaults.cache },
  };
}

const activeTranslators: PageTranslator[] = [];

interface Harness {
  translator: PageTranslator;
  states: PageState[];
  waitForDone: (timeoutMs?: number) => Promise<PageState>;
  waitForError: (timeoutMs?: number) => Promise<PageState>;
  translateCalls: string[][];
  setFail: (value: boolean) => void;
}

function harness(settings: PublicSettings = publicSettings()): Harness {
  const states: PageState[] = [];
  const translateCalls: string[][] = [];
  let fail = false;
  const translator = new PageTranslator(document, {
    translate: async (chunks) => {
      translateCalls.push([...chunks]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (fail) throw new Error('mock provider failure');
      return {
        translations: chunks.map((chunk) => `译:${chunk}`),
        modelName: '测试模型',
      };
    },
    cancel: () => undefined,
    onState: (state) => {
      states.push(state);
    },
  });
  translator.setSettings(settings);
  activeTranslators.push(translator);

  const waitFor = async (predicate: () => boolean, timeoutMs = 4000): Promise<void> => {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for page state');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  return {
    translator,
    states,
    translateCalls,
    setFail: (value: boolean) => {
      fail = value;
    },
    waitForDone: async (timeoutMs?: number) => {
      await waitFor(() => states.some((state) => state.status === 'done'), timeoutMs);
      return translator.getState();
    },
    waitForError: async (timeoutMs?: number) => {
      await waitFor(() => states.some((state) => state.status === 'error'), timeoutMs);
      return translator.getState();
    },
  };
}

afterEach(() => {
  for (const translator of activeTranslators.splice(0)) translator.dispose();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('TreeWalker extraction', () => {
  it('collects ordinary text but skips scripts, editors, code and extension UI', () => {
    document.body.innerHTML = `
      <p>Hello <b>world</b></p>
      <script>script text</script>
      <style>.x{color:red}</style>
      <noscript>noscript text</noscript>
      <code>code text</code>
      <pre>pre text</pre>
      <textarea>textarea text</textarea>
      <input value="input value" />
      <div contenteditable="true">editable text</div>
      <div translate="no">no translate</div>
      <div data-ihou-tsukou="translation">extension text</div>
      <div><span>中文内容</span><span>12345</span></div>
    `;
    const units = collectTextUnits(document.body);
    const texts = units.map((unit) => unit.core);
    expect(texts).toContain('Hello');
    expect(texts).toContain('world');
    expect(texts).toContain('中文内容');
    expect(texts).not.toContain('script text');
    expect(texts).not.toContain('code text');
    expect(texts).not.toContain('editable text');
    expect(texts).not.toContain('no translate');
    expect(texts).not.toContain('extension text');
    expect(texts).not.toContain('12345');
  });

  it('respects the max unit cap', () => {
    document.body.innerHTML = Array.from({ length: 20 }, (_, index) => `<p>Line ${index}</p>`).join('');
    expect(collectTextUnits(document.body, { maxUnits: 5 })).toHaveLength(5);
  });
});

describe('PageTranslator', () => {
  it('defaults to replacement mode', async () => {
    document.body.innerHTML = '<p id="p">Hello</p>';
    const h = harness();
    expect(h.translator.getState().mode).toBe('replace');

    h.translator.start();
    const state = await h.waitForDone();

    expect(state.mode).toBe('replace');
    expect(document.getElementById('p')?.textContent).toBe('译:Hello');
    expect(document.querySelectorAll('[data-ihou-tsukou="translation"]')).toHaveLength(0);
    h.translator.dispose();
  });

  it('translates in bilingual mode without replacing DOM nodes or handlers', async () => {
    document.body.innerHTML =
      '<p id="p">Hello <a id="link" href="/next">world</a></p><button id="button">Click</button>';
    let clicks = 0;
    document.getElementById('button')?.addEventListener('click', () => {
      clicks += 1;
    });
    const link = document.getElementById('link');
    const p = document.getElementById('p');
    const h = harness();

    h.translator.start('bilingual');
    const state = await h.waitForDone();

    expect(state.total).toBe(3);
    expect(state.completed).toBe(3);
    expect(document.querySelectorAll('[data-ihou-tsukou="translation"]')).toHaveLength(3);
    expect(p?.textContent).toContain('Hello');
    expect(p?.textContent).toContain('译:Hello');
    expect(document.getElementById('link')).toBe(link);
    expect(document.getElementById('p')).toBe(p);
    document.getElementById('button')?.click();
    expect(clicks).toBe(1);
    h.translator.dispose();
  });

  it('switches to replacement mode and restores exact original text', async () => {
    document.body.innerHTML = '<p id="p">  Hello <b>world</b>  </p>';
    const h = harness();
    h.translator.start('replace');
    await h.waitForDone();
    // Replace mode intentionally keeps the original leading/trailing whitespace.
    expect(document.getElementById('p')?.textContent).toBe('  译:Hello 译:world  ');
    expect(document.querySelectorAll('[data-ihou-tsukou="translation"]')).toHaveLength(0);

    h.translator.setMode('bilingual');
    expect(document.querySelectorAll('[data-ihou-tsukou="translation"]')).toHaveLength(2);
    h.translator.restore();
    expect(document.getElementById('p')?.textContent).toBe('  Hello world  ');
    expect(document.querySelectorAll('[data-ihou-tsukou="translation"]')).toHaveLength(0);
    expect(h.translator.getState().status).toBe('restored');
    expect(h.translator.getState().mode).toBe('replace');
    h.translator.dispose();
  });

  it('never duplicates translations when start is called repeatedly', async () => {
    document.body.innerHTML = '<p>Hello</p>';
    const h = harness();
    h.translator.start('bilingual');
    h.translator.start('bilingual');
    await h.waitForDone();
    expect(document.querySelectorAll('[data-ihou-tsukou="translation"]')).toHaveLength(1);
    h.translator.start('bilingual');
    expect(document.querySelectorAll('[data-ihou-tsukou="translation"]')).toHaveLength(1);
    h.translator.dispose();
  });

  it('translates dynamically inserted content and changed text nodes', async () => {
    document.body.innerHTML = '<div id="root"><p>Initial</p></div>';
    const h = harness();
    h.translator.start('bilingual');
    await h.waitForDone();

    const added = document.createElement('p');
    added.textContent = 'Dynamic';
    document.getElementById('root')?.appendChild(added);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(document.getElementById('root')?.textContent).toContain('译:Dynamic');

    const first = document.querySelector('#root p');
    if (first?.firstChild) first.firstChild.nodeValue = 'Changed';
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(document.getElementById('root')?.textContent).toContain('译:Changed');
    h.translator.dispose();
  });

  it('does not auto-translate new content when the preference is off', async () => {
    document.body.innerHTML = '<div id="root"><p>Initial</p></div>';
    const h = harness(publicSettings({ autoTranslateNewContent: false }));
    h.translator.start('bilingual');
    await h.waitForDone();
    const added = document.createElement('p');
    added.textContent = 'Late';
    document.getElementById('root')?.appendChild(added);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(document.getElementById('root')?.textContent).not.toContain('译:Late');
    h.translator.dispose();
  });

  it('reports an error, preserves originals and retries failed paragraphs', async () => {
    document.body.innerHTML = '<p>Hello</p><p>World</p>';
    const h = harness();
    h.setFail(true);
    h.translator.start('replace');
    const errorState = await h.waitForError();
    expect(errorState.failed).toBe(2);
    expect(errorState.canRetry).toBe(true);
    expect(document.body.textContent).toBe('HelloWorld');

    h.setFail(false);
    h.translator.retryFailed();
    const done = await h.waitForDone();
    expect(done.failed).toBe(0);
    expect(document.body.textContent).toBe('译:Hello译:World');
    h.translator.dispose();
  });

  it('handles a page with no eligible text without calling the API', async () => {
    document.body.innerHTML = '<script>only script</script><input value="x" />';
    const h = harness();
    h.translator.start();
    const state = await h.waitForDone();
    expect(state.total).toBe(0);
    expect(h.translateCalls).toHaveLength(0);
    h.translator.dispose();
  });

  it('translates a long page within the performance budget', async () => {
    document.body.innerHTML = Array.from(
      { length: 300 },
      (_, index) => `<p>Paragraph ${index} with some words for translation.</p>`,
    ).join('');
    const h = harness();
    const started = Date.now();
    h.translator.start('bilingual');
    const state = await h.waitForDone(15000);
    const elapsed = Date.now() - started;
    expect(state.total).toBe(300);
    expect(state.completed).toBe(300);
    expect(document.querySelectorAll('[data-ihou-tsukou="translation"]')).toHaveLength(300);
    expect(elapsed).toBeLessThan(5000);
    h.translator.dispose();
  });
});