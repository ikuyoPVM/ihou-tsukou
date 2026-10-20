import type { UiActions, UiStore } from './store';
import { useUiState } from './store';
import { SelectionPopover } from './SelectionPopover';
import { SubtitleOverlay } from './SubtitleOverlay';
import { SubtitlePanel } from './SubtitlePanel';

interface Props {
  store: UiStore;
  actions: UiActions;
}

export function OverlayApp({ store, actions }: Props) {
  const state = useUiState(store);
  const subtitle = state.subtitleState;
  const showFloatingButton = Boolean(subtitle && subtitle.videoCount > 0) && !state.panelOpen;

  return (
    <>
      <SelectionPopover trigger={state.trigger} selection={state.selection} actions={actions} />
      <SubtitleOverlay overlay={state.overlay} />
      {state.panelOpen && <SubtitlePanel state={state} actions={actions} />}
      {showFloatingButton && (
        <button
          type="button"
          className="pgp-pill"
          onClick={() => actions.openPanel(true)}
          title="打开意方通行字幕面板"
        >
          <span className="pgp-cc">CC</span>
          {subtitle?.enabled ? '字幕已开启' : '字幕'}
          {subtitle && subtitle.failedCount > 0 ? ` · ${subtitle.failedCount} 失败` : ''}
        </button>
      )}
      {state.toast && (
        <div className="pgp-toast" data-kind={state.toast.kind}>
          {state.toast.message}
        </div>
      )}
    </>
  );
}