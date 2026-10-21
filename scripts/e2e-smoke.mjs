import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const artifacts = join(root, 'artifacts');
const profile = join(artifacts, 'edge-e2e-profile');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const debugPort = 9444;
const correctKey = 'e2e-correct-key-4b9c1f';
const wrongKey = 'e2e-wrong-key-7f2a8d';
const apiRequests = [];

const pageHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>意方通行 E2E Page</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 20px; max-width: 900px; }
  #demo-video { width: 640px; height: 360px; background: #111; display: block; margin: 12px 0; }
  .spacer { height: 600px; }
</style></head>
<body>
  <h1 id="heading">AI translation on the web</h1>
  <p id="one">This extension should translate this sentence into Chinese.</p>
  <p id="two">Visit https://example.com/docs or email test@example.com for details.</p>
  <button id="click" onclick="window.__clicked = (window.__clicked || 0) + 1">Click me once</button>
  <video id="demo-video" controls preload="metadata">
    <track kind="subtitles" src="/subs.vtt" srclang="en" label="English" default>
  </video>
  <p id="three">The quick brown fox jumps over the lazy dog.</p>
  <div id="dynamic-root"></div>
  <div class="spacer"></div>
</body></html>`;

const subtitleVtt = `WEBVTT

00:00:00.000 --> 00:00:10.000
Hello subtitle

00:00:10.000 --> 00:00:20.000
Second subtitle line
`;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

function extractSegments(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = messages.findLast?.((message) => message?.role === 'user') ?? messages[messages.length - 1];
  const text = typeof user?.content === 'string' ? user.content : '';
  const start = text.indexOf('{"segments"');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1)).segments ?? [];
  } catch {
    return [];
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return;
  }
  if (url.pathname === '/' || url.pathname === '/test') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pageHtml);
    return;
  }
  if (url.pathname === '/subs.vtt') {
    res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(subtitleVtt);
    return;
  }
  if (url.pathname === '/v1/models') {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${correctKey}`) {
      sendJson(res, 401, { error: { message: `Invalid API key ${auth}`, code: 'invalid_api_key' } });
      return;
    }
    sendJson(res, 200, { data: [{ id: 'e2e-chat' }] });
    return;
  }
  if (url.pathname === '/v1/chat/completions') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        // handled as a bad request below
      }
      const auth = req.headers.authorization ?? '';
      apiRequests.push({ url: url.pathname, auth, body, at: Date.now() });
      if (!body) {
        sendJson(res, 400, { error: { message: 'bad json' } });
        return;
      }
      if (auth !== `Bearer ${correctKey}`) {
        sendJson(res, 401, {
          error: { message: `Invalid API key: ${auth}. Key is ${wrongKey}`, code: 'invalid_api_key' },
        });
        return;
      }
      const segments = extractSegments(body);
      sendJson(res, 200, {
        id: 'chatcmpl-e2e',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                translations: segments.map((segment) => ({
                  id: segment.id,
                  text: `【中文】${segment.text}`,
                })),
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
          else pending.resolve(message.result);
        }
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params?.exceptionDetails?.text ?? 'exception');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        this.consoleErrors.push(
          (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' '),
        );
      }
    });
  }

  async open(enablePage = true) {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolveOpen, rejectOpen) => {
      this.ws.addEventListener('open', resolveOpen, { once: true });
      this.ws.addEventListener('error', rejectOpen, { once: true });
    });
    await this.send('Runtime.enable');
    if (enablePage) await this.send('Page.enable');
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `Evaluation failed: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`,
      );
    }
    return result.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

async function sleep(ms) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitFor(fn, timeoutMs = 15000, intervalMs = 200) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out. ${lastError instanceof Error ? lastError.message : ''}`);
}

async function fetchJson(path, options) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`, options);
  return response.json();
}

async function createTarget(url) {
  return fetchJson(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
}

async function findTarget(predicate) {
  return waitFor(async () => {
    const list = await fetchJson('/json/list');
    return list.find(predicate);
  });
}

async function targetCdp(target) {
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open(target.type === 'page' || target.type === 'background_page');
  return cdp;
}

async function screenshot(cdp, name, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(artifacts, name), Buffer.from(result.data, 'base64'));
}

async function api(cdp, message) {
  return cdp.evaluate(`(async () => {
    const response = await chrome.runtime.sendMessage(${JSON.stringify(message)});
    if (!response) throw new Error('no response from background');
    if (!response.ok) throw new Error(response.error?.message || 'request failed');
    return response.data;
  })()`);
}

let edgeProcess;
let extensionId = '';
const results = [];

function record(name, detail, ok = true) {
  results.push({ name, detail, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}

try {
  if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  const pageUrl = `http://127.0.0.1:${port}/test`;
  console.log(`test server ${pageUrl}`);

  edgeProcess = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-features=msEdgeSplitScreen,msEdgeSidebarV2',
      `--user-data-dir=${profile}`,
      `--load-extension=${join(root, 'dist')}`,
      `--disable-extensions-except=${join(root, 'dist')}`,
      `--remote-debugging-port=${debugPort}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  const version = await waitFor(async () => {
    try {
      return await fetchJson('/json/version');
    } catch {
      return null;
    }
  }, 30000);
  console.log('browser', version.Browser);

  const workerTarget = await findTarget(
    (target) => target.type === 'service_worker' && target.url.endsWith('/background.js'),
  );
  extensionId = new URL(workerTarget.url).hostname;
  console.log('extension', extensionId);
  const worker = await targetCdp(workerTarget);
  const workerRuntime = await worker.evaluate('({id: chrome.runtime.id, manifest: chrome.runtime.getManifest()})');
  record('extension service worker', workerRuntime, workerRuntime.id === extensionId);

  const optionsTarget = await createTarget(`chrome-extension://${extensionId}/options.html`);
  const options = await targetCdp(optionsTarget);
  await waitFor(async () => options.evaluate("document.querySelector('h1')?.textContent || ''"), 15000);
  const optionsTitle = await options.evaluate('document.body.innerText.slice(0, 400)');
  record('options page renders', optionsTitle.replace(/\s+/g, ' ').slice(0, 120));

  const saved = await api(options, {
    type: 'settings.saveModel',
    model: {
      name: 'E2E Mock',
      providerName: 'Local Mock',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: correctKey,
      protocol: 'openai-chat',
      modelId: 'e2e-chat',
      headers: {},
      params: {},
      temperature: 0,
      enabled: true,
    },
  });
  await api(options, { type: 'settings.setDefaultModel', id: saved.id });
  await api(options, { type: 'settings.setTaskModel', task: 'webpage', id: saved.id });
  await api(options, { type: 'settings.setTaskModel', task: 'subtitles', id: saved.id });
  await api(options, {
    type: 'settings.updatePrefs',
    patch: { languages: { source: 'en', target: 'zh-CN' }, ui: { theme: 'light' } },
  });
  const publicSettings = await api(options, { type: 'settings.getPublic' });
  record(
    'model saved and public settings hide secrets',
    {
      modelId: saved.id,
      models: publicSettings.models.length,
      hasApiKey: JSON.stringify(publicSettings).includes(correctKey),
    },
    !JSON.stringify(publicSettings).includes(correctKey) && publicSettings.models.length === 1,
  );
  await options.send('Page.reload', { ignoreCache: true });
  await sleep(1500);
  const optionsAfterReload = await options.evaluate('document.body.innerText');
  record('options reflects persisted model', optionsAfterReload.includes('E2E Mock'), optionsAfterReload.includes('E2E Mock'));
  await api(options, {
    type: 'settings.updatePrefs',
    patch: { ui: { theme: 'dark' } },
  });
  await options.send('Page.reload', { ignoreCache: true });
  const darkTheme = await waitFor(
    async () => options.evaluate("document.documentElement.dataset.theme === 'dark' ? 'dark' : ''"),
    5000,
  );
  record('dark theme applies', darkTheme, darkTheme === 'dark');
  await api(options, {
    type: 'settings.updatePrefs',
    patch: { ui: { theme: 'light' } },
  });
  await options.send('Page.reload', { ignoreCache: true });
  const lightTheme = await waitFor(
    async () => options.evaluate("document.documentElement.dataset.theme === 'light' ? 'light' : ''"),
    5000,
  );
  record('light theme applies', lightTheme, lightTheme === 'light');
  const openedEditor = await options.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('添加模型'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  const editorOpened = openedEditor
    ? await waitFor(async () => options.evaluate("document.body.innerText.includes('添加模型配置')"), 3000)
    : false;
  record('options add-model button opens editor', { openedEditor, editorOpened }, openedEditor && editorOpened);
  if (editorOpened) {
    await options.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '返回列表');
      button?.click();
    })()`);
  }

  const pageTarget = await createTarget(pageUrl);
  const page = await targetCdp(pageTarget);
  await waitFor(async () => page.evaluate("document.readyState === 'complete'"), 15000);
  const contentReady = await waitFor(
    async () => page.evaluate("Boolean(document.getElementById('ihou-tsukou-ui-host')?.shadowRoot)"),
    15000,
  );
  record('content script mounted', contentReady);
  record('page cannot read chrome.storage', await page.evaluate('typeof chrome.storage'), (await page.evaluate('typeof chrome.storage')) === 'undefined');

  const tabInfo = await options.evaluate(`(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url && item.url.startsWith('http://127.0.0.1:'));
    if (!tab) throw new Error('test tab not found');
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return { id: tab.id, windowId: tab.windowId, url: tab.url };
  })()`);
  record('test tab activated', tabInfo);
  await sleep(300);

  const command = async (value) => api(options, { type: 'tab.command', command: value });
  const tabState = async () => api(options, { type: 'tab.getState' });

  const startSnapshot = await command({ type: 'page:start', mode: 'bilingual' });
  record('background routed page:start', { status: startSnapshot.page.status, total: startSnapshot.page.total });
  const doneState = await waitFor(async () => {
    const state = await tabState();
    return state.page && ['done', 'error'].includes(state.page.status) ? state : null;
  }, 20000);
  record('page translation finished', {
    status: doneState.page.status,
    total: doneState.page.total,
    completed: doneState.page.completed,
    failed: doneState.page.failed,
    model: doneState.page.modelName,
  }, doneState.page.status === 'done' && doneState.page.completed > 0 && doneState.page.failed === 0);
  const reinjected = await options.evaluate(`(async () => {
    try {
      await chrome.scripting.executeScript({ target: { tabId: ${tabInfo.id} }, files: ['content.js'] });
      return true;
    } catch (error) {
      return String(error);
    }
  })()`);
  const hostCount = await page.evaluate("document.querySelectorAll('#ihou-tsukou-ui-host').length");
  record('duplicate content injection is guarded', { reinjected, hostCount }, reinjected === true && hostCount === 1);

  const pageCheck = await page.evaluate(`(() => {
    const spans = [...document.querySelectorAll('[data-ihou-tsukou="translation"]')];
    const one = document.getElementById('one');
    return {
      spans: spans.length,
      oneText: one?.textContent ?? '',
      twoText: document.getElementById('two')?.textContent ?? '',
      clickable: Boolean(document.getElementById('click')),
      keyInDom: document.documentElement.innerHTML.includes(${JSON.stringify(correctKey)}),
      placeholderLeak: document.body.innerText.includes('⟦P'),
      chinese: spans.some((span) => span.textContent.includes('【中文】')),
    };
  })()`);
  record('DOM preserved, translated and no secret leaked', pageCheck, pageCheck.spans > 0 && pageCheck.oneText.includes('This extension') && pageCheck.oneText.includes('【中文】') && !pageCheck.keyInDom && !pageCheck.placeholderLeak);
  record('protected URL survived translation', pageCheck.twoText.includes('https://example.com/docs'), pageCheck.twoText.includes('https://example.com/docs'));
  await page.evaluate("document.getElementById('click').click()");
  record('original event handler survives', await page.evaluate('window.__clicked'), (await page.evaluate('window.__clicked')) === 1);

  await page.evaluate(`(() => {
    const p = document.createElement('p');
    p.id = 'dynamic';
    p.textContent = 'Dynamically inserted content.';
    document.getElementById('dynamic-root').appendChild(p);
  })()`);
  const dynamicState = await waitFor(async () => {
    const text = await page.evaluate("document.getElementById('dynamic-root').textContent");
    return text.includes('【中文】') ? text : null;
  }, 10000);
  record('dynamic content translated', dynamicState);

  const pauseSnapshot = await command({ type: 'page:pause' });
  record('pause command', pauseSnapshot.page.status, pauseSnapshot.page.status === 'paused');
  const resumeSnapshot = await command({ type: 'page:resume' });
  record('resume command', resumeSnapshot.page.status, ['translating', 'done'].includes(resumeSnapshot.page.status));
  await sleep(500);
  const restoreSnapshot = await command({ type: 'page:restore' });
  const restoredSpans = await page.evaluate("document.querySelectorAll('[data-ihou-tsukou=\"translation\"]').length");
  record('restore removes all translations', { status: restoreSnapshot.page.status, spans: restoredSpans }, restoreSnapshot.page.status === 'restored' && restoredSpans === 0);

  await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    root.querySelector('[data-quick-open="true"]')?.click();
  })()`);
  const quickPanelReady = await waitFor(
    async () => page.evaluate("Boolean(document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-quick-panel'))"),
    3000,
  );
  record('floating quick panel opens', quickPanelReady);
  const quickDefaults = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    const panel = root.querySelector('.pgp-quick-panel');
    const rect = panel?.getBoundingClientRect();
    const replace = root.querySelector('[data-quick-mode="replace"]');
    const primary = root.querySelector('[data-quick-primary="true"]');
    return {
      active: replace?.getAttribute('data-active'),
      pressed: replace?.getAttribute('aria-pressed'),
      primary: primary?.textContent?.trim() ?? '',
      width: rect ? Math.round(rect.width) : 0,
      height: rect ? Math.round(rect.height) : 0,
      inViewport: Boolean(rect && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight),
    };
  })()`);
  record(
    'quick panel defaults to replace',
    quickDefaults,
    quickDefaults.active === 'true' &&
      quickDefaults.pressed === 'true' &&
      quickDefaults.primary === '翻译本页' &&
      quickDefaults.width > 250 &&
      quickDefaults.height > 100 &&
      quickDefaults.inViewport,
  );

  const dragStart = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    const rect = root.querySelector('.pgp-quick-header')?.getBoundingClientRect();
    return rect
      ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 18), width: window.innerWidth, height: window.innerHeight }
      : null;
  })()`);
  if (dragStart) {
    const targetX = 16;
    const targetY = Math.max(80, Math.min(260, dragStart.height - 340));
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: dragStart.x,
      y: dragStart.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: dragStart.x - 80,
      y: dragStart.y - 40,
      button: 'left',
      buttons: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: targetX,
      y: targetY,
      button: 'left',
      buttons: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: targetX,
      y: targetY,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  }
  await sleep(250);
  const draggedPanel = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    const rect = root.querySelector('.pgp-quick-panel')?.getBoundingClientRect();
    return rect
      ? { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) }
      : null;
  })()`);
  record(
    'quick panel drags and snaps to edge',
    draggedPanel,
    Boolean(draggedPanel && draggedPanel.left <= 16 && draggedPanel.left >= 8 && draggedPanel.top > 20),
  );

  await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    root.querySelector('[data-quick-primary="true"]')?.click();
  })()`);
  const quickDoneState = await waitFor(async () => {
    const next = await tabState();
    return next.page && next.page.status === 'done' && next.page.mode === 'replace' ? next : null;
  }, 20000);
  const quickPageCheck = await page.evaluate(`(() => {
    const one = document.getElementById('one');
    const spans = document.querySelectorAll('[data-ihou-tsukou="translation"]').length;
    return { text: one?.textContent ?? '', spans };
  })()`);
  record(
    'quick translate uses replacement mode',
    {
      status: quickDoneState.page.status,
      mode: quickDoneState.page.mode,
      spans: quickPageCheck.spans,
      text: quickPageCheck.text,
    },
    quickDoneState.page.status === 'done' &&
      quickDoneState.page.mode === 'replace' &&
      quickPageCheck.spans === 0 &&
      quickPageCheck.text.startsWith('【中文】') &&
      (quickPageCheck.text.match(/This extension/g) ?? []).length === 1,
  );

  await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    root.querySelector('[data-quick-restore="true"]')?.click();
  })()`);
  const quickRestoredState = await waitFor(async () => {
    const next = await tabState();
    return next.page && next.page.status === 'restored' ? next : null;
  }, 5000);
  const quickRestoredSpans = await page.evaluate("document.querySelectorAll('[data-ihou-tsukou=\"translation\"]').length");
  record(
    'quick panel restores original text',
    { status: quickRestoredState.page.status, spans: quickRestoredSpans },
    quickRestoredState.page.status === 'restored' && quickRestoredSpans === 0,
  );

  const panelBeforeCollapse = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    const rect = root.querySelector('.pgp-quick-panel')?.getBoundingClientRect();
    return rect ? { left: Math.round(rect.left), top: Math.round(rect.top) } : null;
  })()`);
  await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    root.querySelector('[aria-label="收起快速翻译"]')?.click();
  })()`);
  const quickCollapsed = await waitFor(
    async () => page.evaluate(`(() => {
      const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
      return !root.querySelector('.pgp-quick-panel') && Boolean(root.querySelector('[data-quick-open="true"]'));
    })()`),
    3000,
  );
  record('quick panel collapses to floating button', quickCollapsed);

  const collapsedFab = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    const rect = root.querySelector('[data-quick-open="true"]')?.getBoundingClientRect();
    return rect
      ? { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right) }
      : null;
  })()`);
  record(
    'collapsed icon docks to the side edge',
    { panelBeforeCollapse, collapsedFab },
    Boolean(
      panelBeforeCollapse &&
        collapsedFab &&
        collapsedFab.left <= 16 &&
        collapsedFab.left >= 8 &&
        collapsedFab.top > panelBeforeCollapse.top + 40,
    ),
  );

  const fabDragStart = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    const fab = root.querySelector('[data-quick-open="true"]');
    const rect = fab?.getBoundingClientRect();
    return rect
      ? {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          viewportWidth: document.documentElement.clientWidth,
        }
      : null;
  })()`);
  if (fabDragStart) {
    const targetX = fabDragStart.viewportWidth - 24;
    const targetY = 260;
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: fabDragStart.x,
      y: fabDragStart.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: targetX,
      y: targetY,
      button: 'left',
      buttons: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: targetX,
      y: targetY,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  }
  await sleep(250);
  const draggedFab = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    const rect = root.querySelector('[data-quick-open="true"]')?.getBoundingClientRect();
    return {
      right: rect ? Math.round(rect.right) : 0,
      viewportWidth: document.documentElement.clientWidth,
      panelOpen: Boolean(root.querySelector('.pgp-quick-panel')),
    };
  })()`);
  record(
    'floating button drags and suppresses accidental open',
    draggedFab,
    !draggedFab.panelOpen &&
      draggedFab.right <= draggedFab.viewportWidth - 8 &&
      draggedFab.right >= draggedFab.viewportWidth - 16,
  );

  await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    root.querySelector('[data-quick-open="true"]')?.click();
  })()`);
  const expandedFromDock = await waitFor(
    async () => page.evaluate(`(() => {
      const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
      const rect = root.querySelector('.pgp-quick-panel')?.getBoundingClientRect();
      return rect
        ? {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            viewportWidth: document.documentElement.clientWidth,
          }
        : null;
    })()`),
    5000,
  );
  record(
    'quick panel expands inward from the docked edge',
    expandedFromDock,
    expandedFromDock.right <= expandedFromDock.viewportWidth - 8 &&
      expandedFromDock.right >= expandedFromDock.viewportWidth - 16 &&
      expandedFromDock.width >= 300,
  );
  await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    root.querySelector('[aria-label="收起快速翻译"]')?.click();
  })()`);
  await waitFor(
    async () => page.evaluate("!document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-quick-panel')"),
    3000,
  );
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 20,
    y: 20,
    button: 'none',
    buttons: 0,
  });
  await sleep(3400);
  const idleDock = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    const fab = root.querySelector('[data-quick-open="true"]');
    const rect = fab?.getBoundingClientRect();
    return {
      right: rect ? Math.round(rect.right) : 0,
      viewportWidth: document.documentElement.clientWidth,
      compact: fab?.getAttribute('data-compact') ?? '',
      panelOpen: Boolean(root.querySelector('.pgp-quick-panel')),
    };
  })()`);
  record(
    'idle collapse keeps the compact icon on the side edge',
    idleDock,
    !idleDock.panelOpen &&
      idleDock.compact === 'true' &&
      idleDock.right <= idleDock.viewportWidth - 8 &&
      idleDock.right >= idleDock.viewportWidth - 16,
  );

  const selection = await page.evaluate(`(() => {
    const element = document.getElementById('one');
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = range.getBoundingClientRect();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 20, clientY: rect.top + 10 }));
    return { text: selection.toString(), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  })()`);
  const trigger = await waitFor(
    async () => page.evaluate("Boolean(document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-trigger'))"),
    5000,
  );
  record('selection trigger appears', { selection, trigger }, trigger);
  await page.evaluate("document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-trigger').click()");
  const selectionTranslation = await waitFor(
    async () => {
      const text = await page.evaluate(
        "document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-selection-translation')?.textContent || ''",
      );
      return text.includes('【中文】') || text.includes('翻译失败') ? text : null;
    },
    10000,
  );
  record('selection translation works', selectionTranslation, selectionTranslation.includes('【中文】'));
  await page.evaluate("document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-icon-button')?.click()");

  const panelSnapshot = await command({ type: 'subtitles:openPanel' });
  record('subtitle panel command', {
    videoCount: panelSnapshot.subtitle.videoCount,
    canUseAsr: panelSnapshot.subtitle.canUseAsr,
    tracks: panelSnapshot.subtitle.tracks.length,
  });
  const panelText = await page.evaluate(
    "document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-panel')?.innerText || ''",
  );
  record('subtitle panel renders', panelText.replace(/\s+/g, ' ').slice(0, 160), panelText.includes('字幕'));

  const nativeTrack = await command({ type: 'subtitles:selectTrack', trackIndex: 0 });
  const nativeMode = await page.evaluate(`document.getElementById('demo-video').textTracks[0]?.mode`);
  record('native TextTrack read and hidden for overlay', {
    source: nativeTrack.subtitle.source,
    cueCount: nativeTrack.subtitle.cueCount,
    mode: nativeMode,
  }, nativeTrack.subtitle.source === 'native' && nativeTrack.subtitle.cueCount >= 2 && nativeMode === 'hidden');
  await command({ type: 'subtitles:translate' });
  const nativeTranslated = await waitFor(async () => {
    const state = await tabState();
    return state.subtitle.source === 'native' &&
      state.subtitle.translatedCount >= 2 &&
      !state.subtitle.translating
      ? state
      : null;
  }, 15000);
  const nativeOverlay = await page.evaluate(
    "document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-subtitle-translation')?.textContent || ''",
  );
  record('native subtitle translated and rendered', {
    translated: nativeTranslated.subtitle.translatedCount,
    overlay: nativeOverlay,
  }, nativeTranslated.subtitle.translatedCount === 2 && nativeOverlay.includes('【中文】'));

  const subtitleSrt = `1\n00:00:00,000 --> 00:00:10,000\nHello subtitle\n\n2\n00:00:10,000 --> 00:00:20,000\nSecond subtitle line\n`;
  const loaded = await command({ type: 'subtitles:loadFile', text: subtitleSrt, filename: 'e2e.srt' });
  record('subtitle file import', {
    cueCount: loaded.subtitle.cueCount,
    source: loaded.subtitle.source,
    enabled: loaded.subtitle.enabled,
  }, loaded.subtitle.cueCount === 2 && loaded.subtitle.source === 'file' && loaded.subtitle.enabled);
  const modeAfterImport = await page.evaluate(`document.getElementById('demo-video').textTracks[0]?.mode`);
  record('native captions hidden after file import', modeAfterImport, modeAfterImport === 'hidden');
  const overlayBefore = await page.evaluate(
    "document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-subtitle-original')?.textContent || ''",
  );
  record('subtitle overlay shows original cue', overlayBefore, overlayBefore.includes('Hello subtitle'));
  const subtitleTranslated = await command({ type: 'subtitles:translate' });
  const subtitleDone = await waitFor(async () => {
    const state = await tabState();
    return state.subtitle.translatedCount >= 2 ? state : null;
  }, 15000);
  const overlayTranslation = await page.evaluate(
    "document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-subtitle-translation')?.textContent || ''",
  );
  record('subtitle translation and overlay', {
    translated: subtitleDone.subtitle.translatedCount,
    failed: subtitleDone.subtitle.failedCount,
    overlay: overlayTranslation,
  }, subtitleDone.subtitle.translatedCount === 2 && subtitleDone.subtitle.failedCount === 0 && overlayTranslation.includes('【中文】'));
  await command({ type: 'subtitles:setMode', mode: 'original' });
  const originalOnly = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    return {
      translation: root.querySelector('.pgp-subtitle-translation')?.textContent || '',
      original: root.querySelector('.pgp-subtitle-original')?.textContent || '',
    };
  })()`);
  record('subtitle original-only mode', originalOnly, originalOnly.original.includes('Hello subtitle') && originalOnly.translation === '');
  await command({ type: 'subtitles:setMode', mode: 'translated' });
  const translatedOnly = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    return {
      translation: root.querySelector('.pgp-subtitle-translation')?.textContent || '',
      original: root.querySelector('.pgp-subtitle-original')?.textContent || '',
    };
  })()`);
  record('subtitle translated-only mode', translatedOnly, translatedOnly.translation.includes('【中文】') && translatedOnly.original === '');
  await command({ type: 'subtitles:setMode', mode: 'bilingual' });
  await command({
    type: 'subtitles:applySubtitlePrefs',
    style: { fontSize: 30, color: '#ffcc00', backgroundOpacity: 0.4 },
  });
  await sleep(300);
  const subtitleStyle = await page.evaluate(`(() => {
    const root = document.getElementById('ihou-tsukou-ui-host').shadowRoot;
    const layer = root.querySelector('.pgp-subtitle-layer');
    const box = root.querySelector('.pgp-subtitle-box');
    return {
      fontSize: layer ? getComputedStyle(layer).fontSize : '',
      color: box ? getComputedStyle(box).color : '',
    };
  })()`);
  record('subtitle style preferences apply', subtitleStyle, subtitleStyle.fontSize === '30px' && subtitleStyle.color === 'rgb(255, 204, 0)');
  await command({
    type: 'subtitles:applySubtitlePrefs',
    style: { fontSize: 22, color: '#ffffff', backgroundOpacity: 0.62 },
  });

  const disabledSubtitle = await command({ type: 'subtitles:enable', enabled: false });
  const overlayAfterDisable = await page.evaluate(
    "Boolean(document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-subtitle-layer'))",
  );
  const modeAfterDisable = await page.evaluate(`document.getElementById('demo-video').textTracks[0]?.mode`);
  record('disabling subtitles removes overlay and restores native mode', {
    enabled: disabledSubtitle.subtitle.enabled,
    overlay: overlayAfterDisable,
    mode: modeAfterDisable,
  }, disabledSubtitle.subtitle.enabled === false && overlayAfterDisable === false && modeAfterDisable !== 'hidden');
  const reenabled = await command({ type: 'subtitles:enable', enabled: true });
  const overlayAfterReenable = await page.evaluate(
    "document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-subtitle-translation')?.textContent || ''",
  );
  record('re-enabling subtitles restores translated overlay', {
    enabled: reenabled.subtitle.enabled,
    overlay: overlayAfterReenable,
  }, reenabled.subtitle.enabled === true && overlayAfterReenable.includes('【中文】'));

  const firstVideoId = reenabled.subtitle.videos.find((video) => video.selected)?.id;
  await page.evaluate(`(() => {
    const video = document.createElement('video');
    video.id = 'second-video';
    video.style.cssText = 'display:block;width:320px;height:180px;background:#222;margin:8px 0';
    document.body.appendChild(video);
  })()`);
  const multiState = await waitFor(async () => {
    const state = await command({ type: 'subtitles:getState' });
    return state.subtitle.videoCount >= 2 ? state : null;
  }, 5000);
  record('multiple videos detected', {
    count: multiState.subtitle.videoCount,
    labels: multiState.subtitle.videos.map((video) => video.label),
  }, multiState.subtitle.videoCount >= 2);
  const secondVideo = multiState.subtitle.videos.find((video) => !video.selected);
  const selectedSecond = await command({ type: 'subtitles:selectVideo', videoId: secondVideo.id });
  record('selecting another video switches session', {
    selected: selectedSecond.subtitle.selectedVideoId,
    expected: secondVideo.id,
    cueCount: selectedSecond.subtitle.cueCount,
  }, selectedSecond.subtitle.selectedVideoId === secondVideo.id);
  const firstVideo = multiState.subtitle.videos.find((video) => video.id === firstVideoId);
  await command({ type: 'subtitles:selectVideo', videoId: firstVideo.id });
  const overlayAfterReturn = await page.evaluate(
    "document.getElementById('ihou-tsukou-ui-host').shadowRoot.querySelector('.pgp-subtitle-translation')?.textContent || ''",
  );
  record('returning to first video restores its translated cues', overlayAfterReturn, overlayAfterReturn.includes('【中文】'));

  const authHeaders = apiRequests.map((request) => request.auth);
  record('mock API received real requests with secret auth', {
    requests: apiRequests.length,
    authOk: authHeaders.every((auth) => auth === `Bearer ${correctKey}`),
    models: [...new Set(apiRequests.map((request) => request.body?.model))],
  }, apiRequests.length > 0 && authHeaders.every((auth) => auth === `Bearer ${correctKey}`));

  const wrong = await api(options, {
    type: 'settings.saveModel',
    model: {
      id: saved.id,
      name: 'E2E Mock',
      providerName: 'Local Mock',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: wrongKey,
      protocol: 'openai-chat',
      modelId: 'e2e-chat',
      headers: {},
      params: {},
      enabled: true,
    },
  });
  record('wrong key saved for error test', wrong.id);
  await sleep(300);
  await command({ type: 'page:retranslate', mode: 'bilingual' });
  const errorState = await waitFor(async () => {
    const state = await tabState();
    return state.page?.status === 'error' ? state : null;
  }, 15000);
  const errorText = JSON.stringify(errorState.page.error ?? {});
  record('wrong key produces differentiated error without leaking key', {
    code: errorState.page.error?.code,
    message: errorState.page.error?.message,
    containsKey: errorText.includes(wrongKey),
  }, errorState.page.error?.code === 'INVALID_API_KEY' && !errorText.includes(wrongKey));

  await api(options, {
    type: 'settings.saveModel',
    model: {
      id: saved.id,
      name: 'E2E Mock',
      providerName: 'Local Mock',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: correctKey,
      protocol: 'openai-chat',
      modelId: 'e2e-chat',
      headers: {},
      params: {},
      enabled: true,
    },
  });
  await command({ type: 'page:retryFailed' });
  const retried = await waitFor(async () => {
    const state = await tabState();
    return state.page?.status === 'done' && state.page.failed === 0 ? state : null;
  }, 15000);
  record('retry succeeds after fixing key', {
    status: retried.page.status,
    completed: retried.page.completed,
    failed: retried.page.failed,
  }, retried.page.status === 'done' && retried.page.failed === 0);

  const popupInfo = await options.evaluate(`(async () => {
    const created = await chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 420,
      height: 680,
      focused: false,
    });
    const tabs = await chrome.tabs.query({});
    const testTab = tabs.find((item) => item.url && item.url.startsWith('http://127.0.0.1:'));
    if (testTab?.windowId) await chrome.windows.update(testTab.windowId, { focused: true });
    return { popupWindowId: created.id };
  })()`);
  record('popup window created', popupInfo);
  const popupTarget = await findTarget((target) => target.url.includes('/popup.html'));
  const popup = await targetCdp(popupTarget);
  await sleep(1500);
  const popupText = await popup.evaluate('document.body.innerText');
  record('popup renders active tab state', popupText.replace(/\s+/g, ' ').slice(0, 200), popupText.includes('意方通行'));
  const popupPrimary = await popup.evaluate(`(() => {
    const button = document.querySelector('.btn-primary');
    return { text: button?.textContent?.trim() || '', disabled: Boolean(button?.disabled) };
  })()`);
  const requestsBeforePopupClick = apiRequests.length;
  await popup.evaluate("document.querySelector('.btn-primary')?.click()");
  const popupActionState = await waitFor(async () => {
    if (apiRequests.length <= requestsBeforePopupClick) return null;
    const state = await tabState();
    return state.page?.status === 'done' ? state : null;
  }, 15000);
  record('popup primary action retranslates page', {
    button: popupPrimary,
    status: popupActionState.page.status,
    requests: apiRequests.length - requestsBeforePopupClick,
  }, !popupPrimary.disabled && popupPrimary.text.length > 0 && popupActionState.page.status === 'done');
  await screenshot(popup, 'popup.png', 420, 680);
  await screenshot(options, 'options.png', 1280, 900);
  await screenshot(page, 'page.png', 1280, 900);

  const allExceptions = [
    ...worker.exceptions,
    ...options.exceptions,
    ...page.exceptions,
    ...popup.exceptions,
  ];
  const allConsoleErrors = [
    ...worker.consoleErrors,
    ...options.consoleErrors,
    ...page.consoleErrors,
    ...popup.consoleErrors,
  ];
  record('no uncaught extension/page exceptions', { exceptions: allExceptions, consoleErrors: allConsoleErrors }, allExceptions.length === 0 && allConsoleErrors.length === 0);

  const summary = {
    browser: version.Browser,
    extensionId,
    pageUrl,
    results,
    apiRequests: apiRequests.length,
    exceptions: allExceptions,
    consoleErrors: allConsoleErrors,
  };
  writeFileSync(join(artifacts, 'e2e-results.json'), JSON.stringify(summary, null, 2));
  const failures = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length > 0) {
    console.error('FAILURES', failures);
    process.exitCode = 1;
  }

  worker.close();
  options.close();
  page.close();
  popup.close();
} finally {
  if (edgeProcess) spawnSync('taskkill', ['/PID', String(edgeProcess.pid), '/T', '/F'], { stdio: 'ignore' });
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}