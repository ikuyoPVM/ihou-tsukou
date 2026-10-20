export interface PageTextUnit {
  node: Text;
  original: string;
  core: string;
  leading: string;
  trailing: string;
}

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'VAR',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'SVG',
  'MATH',
  'CANVAS',
  'IFRAME',
  'OBJECT',
  'EMBED',
]);

const SKIP_SELECTOR = [
  '[data-polyglot-ai]',
  '[data-polyglot-ignore]',
  '[translate="no"]',
  '.notranslate',
  '.polyglot-ai-ui',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[aria-hidden="true"]',
  '[hidden]',
  '.monaco-editor',
  '.CodeMirror',
  '.cm-editor',
  '.ace_editor',
].join(',');

const LETTER_PATTERN = /\p{L}/u;

export function isElementSkipped(element: Element): boolean {
  if (SKIP_TAGS.has(element.tagName.toUpperCase())) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  try {
    if (element.closest(SKIP_SELECTOR)) return true;
  } catch {
    return true;
  }
  return false;
}

export function isTranslatableTextNode(node: Text): boolean {
  if (!node.isConnected) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  if (isElementSkipped(parent)) return false;
  const original = node.nodeValue ?? '';
  const core = original.trim();
  if (!core || core.length < 1 || !LETTER_PATTERN.test(core)) return false;
  // Pure URL/email labels or fragments without a single letter are not useful.
  if (/^[\d\s.,:;!?%/\\|()[\]{}<>+=*&^$#@~`_-]+$/.test(core)) return false;
  return true;
}

export function makePageTextUnit(node: Text): PageTextUnit | null {
  if (!isTranslatableTextNode(node)) return null;
  const original = node.nodeValue ?? '';
  const leading = original.match(/^\s*/)?.[0] ?? '';
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  const core = original.trim();
  if (!core) return null;
  return { node, original, core, leading, trailing };
}

function walk(root: Node, units: PageTextUnit[]): void {
  if (root.nodeType === Node.TEXT_NODE) {
    const unit = makePageTextUnit(root as Text);
    if (unit) units.push(unit);
    return;
  }
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!isTranslatableTextNode(node as Text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    const unit = makePageTextUnit(current as Text);
    if (unit) units.push(unit);
    current = walker.nextNode();
  }
}

/**
 * Extract eligible text nodes with a TreeWalker. No innerHTML is read/written
 * and no element is replaced, so links, event handlers and layout survive.
 */
export function collectTextUnits(
  root: Node = document.body,
  options: { maxUnits?: number; exclude?: Set<Text> } = {},
): PageTextUnit[] {
  if (!root || !root.isConnected) return [];
  const units: PageTextUnit[] = [];
  const maxUnits = options.maxUnits ?? 10_000;
  walk(root, units);
  const exclude = options.exclude;
  const filtered = exclude ? units.filter((unit) => !exclude.has(unit.node)) : units;
  return filtered.slice(0, maxUnits);
}

export function removeTranslationSpans(root: ParentNode = document): number {
  const spans = Array.from(root.querySelectorAll('[data-polyglot-ai="translation"]'));
  for (const span of spans) span.remove();
  return spans.length;
}

export function injectPageStyles(doc: Document = document): void {
  if (doc.getElementById('polyglot-ai-page-styles')) return;
  const style = doc.createElement('style');
  style.id = 'polyglot-ai-page-styles';
  style.textContent = `
    span[data-polyglot-ai="translation"] {
      display: inline !important;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      color: inherit !important;
      background: rgba(16, 185, 129, 0.15) !important;
      border-bottom: 1px dotted rgba(13, 148, 136, 0.75) !important;
      border-radius: 2px !important;
      padding: 0 2px !important;
      margin-inline-start: 0.25em !important;
      font: inherit !important;
      line-height: inherit !important;
      text-align: inherit !important;
      white-space: pre-wrap !important;
    }
  `;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export function removePageStyles(doc: Document = document): void {
  doc.getElementById('polyglot-ai-page-styles')?.remove();
}