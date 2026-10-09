import type { Room } from '../types/multiplayer';
import type { Difficulty } from '../types';
import { multiplayerClient, type MultiplayerEvent } from '../multiplayer';
import { escapeHtml } from './dom';

// ============================================================================
// Multiplayer UI: create/join modal and the room bar shown on song select.
// ============================================================================

const NAME_KEY = 'sm99.playerName';

/** Create/join modal. Resolves when a room is entered or the modal is closed. */
export function openMultiplayerModal(prefillCode = ''): Promise<boolean> {
  return new Promise((resolve) => {
    const savedName = localStorage.getItem(NAME_KEY) ?? '';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal glass" role="dialog" aria-label="Multiplayer">
        <header><h2>Battle Royale</h2><p>Up to 8 players. Every 15 combo sends an arrow to a rival. Last one standing wins.</p></header>
        <label class="field"><span>Player name</span><input id="mp-name" maxlength="20" value="${escapeHtml(savedName)}" placeholder="DANCER" autocomplete="nickname" /></label>
        <div class="modal-actions">
          <button class="btn btn-primary" id="mp-create">Create room</button>
          <div class="join-row">
            <input id="mp-code" maxlength="8" placeholder="ROOM CODE" value="${escapeHtml(prefillCode)}" />
            <button class="btn" id="mp-join">Join</button>
          </div>
        </div>
        <p class="modal-error" aria-live="polite"></p>
        <button class="modal-close" aria-label="Close">✕</button>
      </div>`;
    document.body.appendChild(overlay);
    const $ = <T extends HTMLElement>(s: string) => overlay.querySelector(s) as T;
    const nameInput = $<HTMLInputElement>('#mp-name');
    const codeInput = $<HTMLInputElement>('#mp-code');
    (prefillCode ? nameInput : nameInput).focus();

    const error = (msg: string) => ($('.modal-error').textContent = msg);
    const onEvent = (e: MultiplayerEvent) => {
      if (e.type === 'room-created' || e.type === 'room-joined') close(true);
      else if (e.type === 'error') error(String(e.data));
    };
    multiplayerClient.addEventListener(onEvent);

    const close = (entered: boolean) => {
      multiplayerClient.removeEventListener(onEvent);
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(entered);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.code === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey, true);

    const name = (): string | null => {
      const n = nameInput.value.trim();
      if (!n) {
        error('Pick a name first');
        nameInput.focus();
        return null;
      }
      localStorage.setItem(NAME_KEY, n);
      return n;
    };

    $('#mp-create').addEventListener('click', async () => {
      const n = name();
      if (!n) return;
      try {
        await multiplayerClient.connect();
        multiplayerClient.createRoom(n);
      } catch {
        error('Server unreachable');
      }
    });
    const join = async () => {
      const n = name();
      if (!n) return;
      const code = codeInput.value.trim().toUpperCase();
      if (code.length !== 8) {
        error('Room codes have 8 characters');
        codeInput.focus();
        return;
      }
      try {
        await multiplayerClient.connect();
        multiplayerClient.joinRoom(code, n);
      } catch {
        error('Server unreachable');
      }
    };
    $('#mp-join').addEventListener('click', join);
    codeInput.addEventListener('keydown', (e) => e.code === 'Enter' && join());
    $('.modal-close').addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => e.target === overlay && close(false));
  });
}

export function roomBarHtml(room: Room): string {
  const me = multiplayerClient.getPlayerId();
  const host = multiplayerClient.isHost();
  const ready = room.players.filter((p) => p.isHost || p.isReady).length;
  const allReady = ready === room.players.length && room.players.length >= 2;
  const self = room.players.find((p) => p.id === me);
  return `
    <div class="room-bar glass">
      <div class="room-code"><span>ROOM</span><b>${escapeHtml(room.code)}</b><button class="chip" data-mp="share" title="Copy invite link">Copy link</button></div>
      <div class="room-players">${room.players
        .map((p) => `<span class="room-player ${p.isReady || p.isHost ? 'ready' : ''} ${p.id === me ? 'me' : ''}">${p.isHost ? '★ ' : ''}${escapeHtml(p.name)}</span>`)
        .join('')}<span class="room-slots">${room.players.length}/${room.maxPlayers}</span></div>
      <div class="room-actions">
        ${host
          ? `<span class="room-ready">${ready}/${room.players.length} ready</span><button class="btn btn-primary" data-mp="start" ${allReady ? '' : 'disabled'}>Start battle</button>`
          : `<span class="room-ready">Host picks the song</span><button class="btn ${self?.isReady ? 'btn-primary' : ''}" data-mp="ready">${self?.isReady ? 'Ready ✓' : 'Ready up'}</button>`}
        <button class="btn btn-ghost" data-mp="leave">Leave</button>
      </div>
    </div>`;
}

export function bindRoomBar(root: HTMLElement, selection: () => { songId: string; difficulty: Difficulty } | null, onLeave: () => void): void {
  root.querySelectorAll<HTMLElement>('[data-mp]').forEach((b) =>
    b.addEventListener('click', () => {
      const room = multiplayerClient.getRoom();
      if (!room) return;
      switch (b.dataset.mp) {
        case 'share': {
          const url = new URL(window.location.href);
          url.searchParams.set('room', room.code);
          void navigator.clipboard.writeText(url.toString());
          b.textContent = 'Copied ✓';
          setTimeout(() => (b.textContent = 'Copy link'), 1500);
          break;
        }
        case 'start': {
          const sel = selection();
          if (!sel) return;
          multiplayerClient.selectSong(sel.songId, sel.difficulty);
          multiplayerClient.startGame();
          break;
        }
        case 'ready':
          multiplayerClient.toggleReady();
          break;
        case 'leave': {
          multiplayerClient.leaveRoom();
          const url = new URL(window.location.href);
          url.searchParams.delete('room');
          window.history.replaceState({}, '', url.toString());
          onLeave();
          break;
        }
      }
    })
  );
}
