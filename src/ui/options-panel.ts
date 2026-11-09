import type { Settings } from '../types';
import { OPTIONS, PANEL_GROUPS, optionForKey, type OptionId, type OptionKind } from './options';
import { escapeHtml } from './dom';

// ============================================================================
// Options panel: the options set once, grouped, each with what it does.
// Keyboard: ↑↓ pick, ←→ change, Enter flips or runs, O/Esc close; every option
// hotkey keeps working inside. It owns the keyboard while open.
// ============================================================================

export interface OptionsPanelContext {
  settings: () => Settings;
  inRoom: boolean;
  /** Step an option; the panel redraws from settings() right after */
  change: (kind: OptionKind, dir: number) => void;
  calibrate: () => void;
}

const kbd = (keys: string[]) => keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('');

export function openOptionsPanel(ctx: OptionsPanelContext): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal options-panel glass" role="dialog" aria-label="Options">
        <header><h2>Options</h2></header>
        ${PANEL_GROUPS.map(
          (g) => `
          <section class="op-group">
            <h3>${g.title}</h3>
            ${g.ids
              .map((id) => {
                const o = OPTIONS[id];
                return `<button class="op-row" data-id="${id}" ${o.solo && ctx.inRoom ? 'disabled title="Not in a battle room"' : ''}>
                  <span class="op-text"><span class="op-l">${o.label}</span><span class="op-hint">${escapeHtml(o.hint)}</span></span>
                  <b class="op-v"></b>
                  <span class="op-k">${kbd(o.keys)}</span>
                </button>`;
              })
              .join('')}
          </section>`
        ).join('')}
        <footer class="op-foot"><span>${kbd(['↑', '↓'])} choose</span><span>${kbd(['←', '→'])} change</span><span>${kbd(['O'])}${kbd(['Esc'])} close</span></footer>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>`;
    document.body.appendChild(overlay);

    const rows = [...overlay.querySelectorAll<HTMLButtonElement>('.op-row')];
    const usable = rows.filter((r) => !r.disabled);
    let cursor = 0;

    const draw = () => {
      const s = ctx.settings();
      for (const r of rows) {
        const o = OPTIONS[r.dataset.id as OptionId];
        (r.querySelector('.op-v') as HTMLElement).textContent = o.value(s);
        r.classList.toggle('warn', !!o.warn?.(s));
      }
    };
    const focus = (i: number) => {
      if (usable.length === 0) return;
      cursor = Math.max(0, Math.min(usable.length - 1, i));
      usable[cursor]!.focus({ preventScroll: true });
    };

    const close = () => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve();
    };
    const run = (id: OptionId, dir: number) => {
      const o = OPTIONS[id];
      if (o.solo && ctx.inRoom) return;
      if (id === 'calibrate') {
        close();
        ctx.calibrate();
        return;
      }
      ctx.change(id, dir);
      draw();
    };

    const onKey = (e: KeyboardEvent) => {
      // Tab moves between rows like any dialog; everything else stays here
      if (e.code === 'Tab') return;
      e.stopPropagation();
      const focused = usable[cursor]?.dataset.id as OptionId | undefined;
      switch (e.code) {
        case 'Escape':
        case 'KeyO':
          e.preventDefault();
          if (!e.repeat) close();
          return;
        case 'ArrowUp':
        case 'ArrowDown':
          e.preventDefault();
          focus(cursor + (e.code === 'ArrowUp' ? -1 : 1));
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          if (focused && focused !== 'calibrate') run(focused, e.code === 'ArrowLeft' ? -1 : 1);
          return;
        // Space is left to the button: it clicks on release
        case 'Enter':
          e.preventDefault();
          if (focused && !e.repeat) run(focused, e.shiftKey ? -1 : 1);
          return;
      }
      const hot = optionForKey(e);
      if (!hot) return;
      e.preventDefault();
      if (hot.id === 'calibrate' && e.repeat) return;
      const i = usable.findIndex((r) => r.dataset.id === hot.id);
      if (i >= 0) focus(i);
      run(hot.id, hot.dir);
    };
    window.addEventListener('keydown', onKey, true);

    rows.forEach((r, i) => {
      r.addEventListener('click', (e) => run(r.dataset.id as OptionId, e.shiftKey ? -1 : 1));
      r.addEventListener('focus', () => {
        const u = usable.indexOf(rows[i]!);
        if (u >= 0) cursor = u;
      });
    });
    overlay.querySelector('.modal-close')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => e.target === overlay && close());

    draw();
    focus(0);
  });
}
