export const CONTENT_UI_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  --pgp-accent: #14b8a6;
  --pgp-accent-strong: #0f9f91;
  --pgp-bg: rgba(255, 255, 255, 0.97);
  --pgp-surface: #ffffff;
  --pgp-surface-2: #f4f7f7;
  --pgp-border: rgba(15, 23, 42, 0.1);
  --pgp-text: #172033;
  --pgp-muted: #64748b;
  --pgp-danger: #d94646;
  --pgp-shadow: 0 16px 48px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
  color-scheme: light;
}
:host([data-theme="dark"]) {
  --pgp-bg: rgba(17, 25, 35, 0.97);
  --pgp-surface: #111923;
  --pgp-surface-2: #1a2531;
  --pgp-border: rgba(148, 163, 184, 0.18);
  --pgp-text: #e7eef6;
  --pgp-muted: #94a3b8;
  --pgp-shadow: 0 18px 52px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
  color-scheme: dark;
}
* { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
.pgp-layer { position: fixed; inset: 0; pointer-events: none; }
.pgp-panel {
  position: fixed;
  top: 16px;
  right: 16px;
  width: min(370px, calc(100vw - 24px));
  max-height: min(88vh, 820px);
  overflow: auto;
  pointer-events: auto;
  background: var(--pgp-bg);
  color: var(--pgp-text);
  border: 1px solid var(--pgp-border);
  border-radius: 18px;
  box-shadow: var(--pgp-shadow);
  backdrop-filter: blur(18px) saturate(140%);
  padding: 16px;
  font-size: 13px;
  line-height: 1.45;
  scrollbar-width: thin;
}
.pgp-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.pgp-brand { display: flex; gap: 10px; align-items: center; }
.pgp-mark {
  width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center;
  background: linear-gradient(135deg, #14b8a6, #3b82f6); color: white; font-weight: 800; font-size: 15px;
  box-shadow: 0 6px 16px rgba(20, 184, 166, 0.28);
}
.pgp-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
.pgp-subtitle { color: var(--pgp-muted); font-size: 11px; margin-top: 1px; }
.pgp-icon-button {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--pgp-border);
  background: var(--pgp-surface-2); color: var(--pgp-text); display: grid; place-items: center;
  font-size: 14px; line-height: 1; padding: 0;
}
.pgp-icon-button:hover { border-color: var(--pgp-accent); color: var(--pgp-accent-strong); }
.pgp-section { border-top: 1px solid var(--pgp-border); padding-top: 11px; margin-top: 11px; }
.pgp-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--pgp-muted); margin-bottom: 8px; }
.pgp-row { display: flex; align-items: center; gap: 8px; }
.pgp-between { justify-content: space-between; }
.pgp-grow { flex: 1; min-width: 0; }
.pgp-stack { display: flex; flex-direction: column; gap: 8px; }
.pgp-muted { color: var(--pgp-muted); }
.pgp-small { font-size: 11px; }
.pgp-error { color: var(--pgp-danger); background: color-mix(in srgb, var(--pgp-danger) 9%, transparent); border: 1px solid color-mix(in srgb, var(--pgp-danger) 22%, transparent); border-radius: 9px; padding: 8px 10px; font-size: 12px; }
.pgp-success { color: var(--pgp-accent-strong); background: color-mix(in srgb, var(--pgp-accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--pgp-accent) 20%, transparent); border-radius: 9px; padding: 7px 9px; font-size: 11px; }
.pgp-btn {
  border: 1px solid var(--pgp-border); background: var(--pgp-surface-2); color: var(--pgp-text);
  border-radius: 9px; padding: 7px 11px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
}
.pgp-btn:hover:not(:disabled) { border-color: var(--pgp-accent); background: color-mix(in srgb, var(--pgp-accent) 8%, var(--pgp-surface-2)); }
.pgp-btn:active:not(:disabled) { transform: translateY(1px); }
.pgp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pgp-btn-primary { background: linear-gradient(135deg, var(--pgp-accent), #2f80ed); border-color: transparent; color: white; }
.pgp-btn-primary:hover:not(:disabled) { background: linear-gradient(135deg, var(--pgp-accent-strong), #2563c9); border-color: transparent; }
.pgp-btn-danger { color: var(--pgp-danger); }
.pgp-btn-block { width: 100%; }
.pgp-field { display: flex; flex-direction: column; gap: 4px; }
.pgp-label { font-size: 11px; font-weight: 600; color: var(--pgp-muted); }
.pgp-select, .pgp-input {
  width: 100%; min-height: 32px; border-radius: 8px; border: 1px solid var(--pgp-border);
  background: var(--pgp-surface-2); color: var(--pgp-text); padding: 5px 8px; font-size: 12px; outline: none;
}
.pgp-select:focus, .pgp-input:focus { border-color: var(--pgp-accent); }
.pgp-segmented { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; background: var(--pgp-surface-2); border: 1px solid var(--pgp-border); border-radius: 9px; padding: 2px; }
.pgp-segment { border: none; background: transparent; color: var(--pgp-muted); border-radius: 7px; padding: 5px 4px; font-size: 11px; font-weight: 600; }
.pgp-segment[data-active="true"] { background: var(--pgp-surface); color: var(--pgp-text); box-shadow: 0 1px 4px rgba(15, 23, 42, 0.13); }
.pgp-switch { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; }
.pgp-switch input { appearance: none; width: 34px; height: 19px; border-radius: 999px; background: var(--pgp-border); position: relative; transition: background 140ms ease; }
.pgp-switch input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: white; transition: transform 140ms ease; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.pgp-switch input:checked { background: var(--pgp-accent); }
.pgp-switch input:checked::after { transform: translateX(15px); }
.pgp-range-row { display: grid; grid-template-columns: 64px 1fr 40px; gap: 8px; align-items: center; font-size: 11px; color: var(--pgp-muted); }
.pgp-range { width: 100%; accent-color: var(--pgp-accent); }
.pgp-divider { height: 1px; background: var(--pgp-border); margin: 2px 0; }
.pgp-chip { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; background: var(--pgp-surface-2); border: 1px solid var(--pgp-border); color: var(--pgp-muted); padding: 3px 8px; font-size: 10px; font-weight: 600; }
.pgp-chip strong { color: var(--pgp-text); font-weight: 700; }
.pgp-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--pgp-accent) 30%, transparent); border-top-color: var(--pgp-accent); animation: pgp-spin 0.7s linear infinite; display: inline-block; }
@keyframes pgp-spin { to { transform: rotate(360deg); } }
.pgp-file-input { display: none; }
.pgp-pill {
  position: fixed; right: 18px; bottom: 76px; pointer-events: auto;
  border: 1px solid var(--pgp-border); border-radius: 999px; padding: 8px 12px;
  background: var(--pgp-bg); color: var(--pgp-text); box-shadow: var(--pgp-shadow);
  display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; backdrop-filter: blur(12px);
}
.pgp-pill:hover { border-color: var(--pgp-accent); color: var(--pgp-accent-strong); }
.pgp-cc { font-size: 10px; font-weight: 800; border: 1px solid currentColor; border-radius: 3px; padding: 1px 3px; letter-spacing: -0.03em; }
.pgp-quick-fab {
  position: fixed; right: 18px; bottom: 18px; z-index: 4; pointer-events: auto;
  display: flex; align-items: center; gap: 8px;
  border: 1px solid color-mix(in srgb, var(--pgp-accent) 45%, transparent);
  border-radius: 999px; padding: 7px 14px 7px 7px;
  background: linear-gradient(135deg, var(--pgp-accent), #2563eb);
  color: white; font-size: 12px; font-weight: 750; letter-spacing: 0.01em;
  box-shadow: 0 8px 26px rgba(15, 118, 110, 0.34), 0 2px 7px rgba(15, 23, 42, 0.2);
  cursor: grab; touch-action: none; user-select: none;
  transition: transform 120ms ease, box-shadow 120ms ease, left 140ms ease, top 140ms ease;
}
.pgp-quick-fab[data-dragging="true"] {
  cursor: grabbing; transition: none;
}
.pgp-quick-fab:hover {
  transform: translateY(-1px);
  box-shadow: 0 11px 30px rgba(15, 118, 110, 0.42), 0 2px 8px rgba(15, 23, 42, 0.22);
}
.pgp-quick-fab:active { transform: translateY(0); }
.pgp-quick-fab-label {
  overflow: hidden; white-space: nowrap; max-width: 96px; opacity: 1;
  transition: max-width 180ms ease, opacity 140ms ease;
}
.pgp-quick-fab[data-compact="true"] {
  padding: 6px; gap: 0; border-radius: 14px;
  box-shadow: 0 6px 18px rgba(15, 118, 110, 0.28), 0 1px 5px rgba(15, 23, 42, 0.18);
}
.pgp-quick-fab[data-compact="true"] .pgp-quick-fab-label { max-width: 0; opacity: 0; }
.pgp-quick-fab-mark {
  width: 27px; height: 27px; border-radius: 8px; display: grid; place-items: center;
  background: rgba(255, 255, 255, 0.18); border: 1px solid rgba(255, 255, 255, 0.24);
  font-size: 13px; font-weight: 800;
}
.pgp-quick-panel {
  position: fixed; right: 18px; bottom: 18px; z-index: 4; pointer-events: auto;
  width: min(330px, calc(100vw - 24px)); max-height: min(76vh, 590px); overflow: auto;
  background: var(--pgp-bg); color: var(--pgp-text);
  border: 1px solid var(--pgp-border); border-radius: 18px;
  box-shadow: var(--pgp-shadow); backdrop-filter: blur(18px) saturate(140%);
  padding: 14px; font-size: 13px; line-height: 1.45; scrollbar-width: thin;
  transition: left 140ms ease, top 140ms ease;
}
.pgp-quick-panel[data-dragging="true"] { transition: none; }
.pgp-quick-header {
  margin-bottom: 10px; cursor: grab; touch-action: none; user-select: none;
}
.pgp-quick-header[data-dragging="true"] { cursor: grabbing; }
.pgp-quick-header button { cursor: pointer; }
.pgp-quick-status { display: flex; flex-direction: column; gap: 5px; }
.pgp-quick-progress {
  height: 5px; border-radius: 999px; overflow: hidden;
  background: var(--pgp-surface-2); border: 1px solid var(--pgp-border);
}
.pgp-quick-progress > span {
  display: block; height: 100%; border-radius: inherit;
  background: linear-gradient(90deg, var(--pgp-accent), #3b82f6);
  transition: width 180ms ease;
}
.pgp-quick-model { color: var(--pgp-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pgp-quick-modes { margin-top: 10px; }
.pgp-quick-primary { margin-top: 9px; min-height: 36px; }
.pgp-quick-secondary { margin-top: 7px; }
.pgp-quick-tip { margin-top: 9px; color: var(--pgp-muted); font-size: 10px; line-height: 1.45; }
.pgp-quick-panel .pgp-error, .pgp-quick-panel .pgp-success { margin-top: 8px; }
.pgp-subtitle-layer {
  position: fixed; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 4px;
  text-align: center; z-index: 2;
}
.pgp-subtitle-box {
  display: inline-block; max-width: 100%; padding: 7px 14px; border-radius: 8px;
  background: rgba(0, 0, 0, var(--pgp-subtitle-opacity, 0.62));
  color: var(--pgp-subtitle-color, #fff); text-shadow: 0 1px 3px rgba(0,0,0,.8);
  box-decoration-break: clone; -webkit-box-decoration-break: clone;
}
.pgp-subtitle-original { opacity: 0.78; }
.pgp-subtitle-translation { font-weight: 600; }
.pgp-subtitle-original + .pgp-subtitle-translation { margin-top: 2px; }
.pgp-trigger {
  position: fixed; pointer-events: auto; width: 34px; height: 34px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.25); color: white; font-weight: 800; font-size: 13px;
  background: linear-gradient(135deg, #14b8a6, #2563eb); box-shadow: 0 6px 20px rgba(15, 23, 42, 0.3);
  display: grid; place-items: center; transition: transform 120ms ease;
}
.pgp-trigger:hover { transform: translateY(-1px) scale(1.04); }
.pgp-selection {
  position: fixed; width: min(350px, calc(100vw - 24px)); pointer-events: auto;
  background: var(--pgp-bg); color: var(--pgp-text); border: 1px solid var(--pgp-border);
  border-radius: 14px; box-shadow: var(--pgp-shadow); padding: 12px; backdrop-filter: blur(16px);
  font-size: 13px;
}
.pgp-selection-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.pgp-selection-source { color: var(--pgp-muted); font-size: 11px; }
.pgp-selection-original { background: var(--pgp-surface-2); border-radius: 8px; padding: 7px 9px; color: var(--pgp-muted); max-height: 80px; overflow: auto; white-space: pre-wrap; }
.pgp-selection-translation { margin-top: 8px; white-space: pre-wrap; line-height: 1.55; max-height: 180px; overflow: auto; font-size: 14px; }
.pgp-selection-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
.pgp-toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 8; pointer-events: none;
  background: var(--pgp-text); color: var(--pgp-surface); border-radius: 9px; padding: 8px 14px;
  font-size: 12px; box-shadow: var(--pgp-shadow); max-width: min(420px, calc(100vw - 40px));
  white-space: pre-wrap; text-align: center;
}
.pgp-toast[data-kind="error"] { background: var(--pgp-danger); color: white; }
.pgp-toast[data-kind="success"] { background: var(--pgp-accent-strong); color: white; }
.pgp-empty { padding: 14px; border: 1px dashed var(--pgp-border); border-radius: 10px; text-align: center; color: var(--pgp-muted); font-size: 12px; }
@media (max-width: 520px) {
  .pgp-panel { top: 8px; right: 8px; width: calc(100vw - 16px); max-height: 80vh; }
  .pgp-quick-panel { right: 12px; bottom: 12px; width: calc(100vw - 24px); max-height: 72vh; }
  .pgp-quick-fab { right: 12px; bottom: 12px; }
  .pgp-pill { right: 12px; bottom: 70px; }
}
`;