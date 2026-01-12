/**
 * Multiplayer Lobby Screen
 *
 * Handles room creation, joining, and pre-game lobby management.
 */

import type { Song, Difficulty } from '../types';
import type { Room } from '../types/multiplayer';
import { multiplayerClient, checkServerHealth } from '../multiplayer';
import type { MultiplayerEvent } from '../multiplayer';

// ============================================================================
// Types
// ============================================================================

export interface LobbyScreenCallbacks {
  onStartGame: (songId: string, difficulty: Difficulty) => void;
  onCancel: () => void;
}

// ============================================================================
// Theme Colors (matching main theme)
// ============================================================================

const THEME = {
  bgPrimary: '#0a0a0f',
  bgSecondary: '#12121a',
  bgTertiary: '#1a1a25',
  textPrimary: '#ffffff',
  textSecondary: '#a0a0b0',
  accentPrimary: '#00d4ff',
  accentSecondary: '#ff00aa',
  accentSuccess: '#00ff88',
  accentWarning: '#ffaa00',
  accentError: '#ff4444',
};

// ============================================================================
// Lobby Screen Class
// ============================================================================

export class LobbyScreen {
  private container: HTMLElement;
  private callbacks: LobbyScreenCallbacks;
  private songs: Song[] = [];
  private serverAvailable = false;
  private element: HTMLElement | null = null;

  constructor(container: HTMLElement, callbacks: LobbyScreenCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    // Listen to multiplayer events
    multiplayerClient.addEventListener(this.handleMultiplayerEvent.bind(this));
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Show lobby screen
   * @param songs - Available songs
   * @param roomCode - Optional room code to pre-fill for joining
   */
  async show(songs: Song[], roomCode?: string): Promise<void> {
    this.songs = songs;
    this.serverAvailable = await checkServerHealth();

    this.render();

    // Pre-fill room code if provided
    if (roomCode && this.element) {
      const codeInput = this.element.querySelector('#room-code') as HTMLInputElement;
      if (codeInput) {
        codeInput.value = roomCode.toUpperCase();
      }
    }
  }

  /**
   * Hide lobby screen
   */
  hide(): void {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * Main render function
   */
  private render(): void {
    this.hide();

    this.element = document.createElement('div');
    this.element.className = 'lobby-screen';
    this.element.innerHTML = this.getHTML();
    this.container.appendChild(this.element);

    this.attachStyles();
    this.attachEventListeners();
    this.updateUI();
  }

  /**
   * Get HTML template
   */
  private getHTML(): string {
    const room = multiplayerClient.getRoom();
    const isConnected = multiplayerClient.isConnected();

    if (room) {
      return this.getRoomHTML(room);
    }

    return this.getMainMenuHTML(isConnected);
  }

  /**
   * Main menu HTML (create/join room)
   */
  private getMainMenuHTML(_isConnected: boolean): string {
    const serverStatus = this.serverAvailable
      ? `<span class="status-online">Server Online</span>`
      : `<span class="status-offline">Server Offline</span>`;

    return `
      <div class="lobby-container">
        <header class="lobby-header">
          <h1>Stepmania99</h1>
          <p class="subtitle">Multiplayer Battle Royale</p>
          <div class="server-status">${serverStatus}</div>
        </header>

        <div class="lobby-content">
          ${
            this.serverAvailable
              ? `
            <div class="lobby-section">
              <h2>Create Room</h2>
              <div class="input-group">
                <input type="text" id="player-name" placeholder="Your name" maxlength="20" />
                <button id="create-room-btn" class="btn btn-primary">Create Room</button>
              </div>
            </div>

            <div class="lobby-divider">
              <span>OR</span>
            </div>

            <div class="lobby-section">
              <h2>Join Room</h2>
              <div class="input-group">
                <input type="text" id="join-player-name" placeholder="Your name" maxlength="20" />
                <input type="text" id="room-code" placeholder="Room code" maxlength="8" />
                <button id="join-room-btn" class="btn btn-secondary">Join Room</button>
              </div>
            </div>
          `
              : `
            <div class="lobby-section offline-message">
              <h2>Server Unavailable</h2>
              <p>The multiplayer server is not available right now.</p>
              <p>You can still play in solo mode!</p>
              <button id="retry-connection-btn" class="btn btn-secondary">Retry Connection</button>
            </div>
          `
          }
        </div>

        <footer class="lobby-footer">
          <button id="back-btn" class="btn btn-ghost">Back to Solo Mode</button>
        </footer>
      </div>

      <div class="error-toast hidden" id="error-toast"></div>
    `;
  }

  /**
   * Room HTML (in a room, waiting for game)
   */
  private getRoomHTML(room: Room): string {
    const isHost = multiplayerClient.isHost();
    const localPlayerId = multiplayerClient.getPlayerId();

    const playersHTML = room.players
      .map((player) => {
        const isLocal = player.id === localPlayerId;
        const statusClass = player.isReady ? 'ready' : 'not-ready';
        const hostBadge = player.isHost ? '<span class="badge host">HOST</span>' : '';
        const youBadge = isLocal ? '<span class="badge you">YOU</span>' : '';
        const readyText = player.isHost ? '' : player.isReady ? 'Ready' : 'Not Ready';

        return `
          <div class="player-card ${statusClass} ${isLocal ? 'local' : ''}">
            <div class="player-name">${player.name} ${hostBadge} ${youBadge}</div>
            <div class="player-status">${readyText}</div>
          </div>
        `;
      })
      .join('');

    const songSelectHTML = isHost
      ? `
        <div class="song-select-section">
          <h3>Select Song</h3>
          <select id="song-select" class="song-dropdown">
            <option value="">-- Select a song --</option>
            ${this.songs
              .map(
                (song) => `
              <option value="${song.id}" ${room.songId === song.id ? 'selected' : ''}>
                ${song.title} - ${song.artist}
              </option>
            `
              )
              .join('')}
          </select>
          <select id="difficulty-select" class="difficulty-dropdown">
            <option value="">-- Select difficulty --</option>
          </select>
        </div>
      `
      : room.songId
        ? `
        <div class="selected-song">
          <h3>Selected Song</h3>
          <p>${this.songs.find((s) => s.id === room.songId)?.title || 'Unknown'}</p>
          <p class="difficulty">${room.difficulty || ''}</p>
        </div>
      `
        : `
        <div class="waiting-song">
          <p>Waiting for host to select a song...</p>
        </div>
      `;

    const allReady = room.players.every((p) => p.isHost || p.isReady);
    const canStart = isHost && room.songId && room.difficulty && room.players.length >= 2 && allReady;

    return `
      <div class="lobby-container room-view">
        <header class="lobby-header">
          <h1>Room: ${room.code}</h1>
          <p class="subtitle">${room.players.length}/${room.maxPlayers} Players</p>
        </header>

        <div class="lobby-content">
          <div class="players-section">
            <h2>Players</h2>
            <div class="players-grid">
              ${playersHTML}
              ${Array(room.maxPlayers - room.players.length)
                .fill(0)
                .map(() => '<div class="player-card empty">Waiting for player...</div>')
                .join('')}
            </div>
          </div>

          ${songSelectHTML}

          <div class="room-actions">
            ${
              isHost
                ? `
              <button id="start-game-btn" class="btn btn-primary btn-large" ${canStart ? '' : 'disabled'}>
                Start Game
              </button>
            `
                : `
              <button id="ready-btn" class="btn btn-primary btn-large">
                ${room.players.find((p) => p.id === localPlayerId)?.isReady ? 'Cancel Ready' : 'Ready'}
              </button>
            `
            }
          </div>
        </div>

        <footer class="lobby-footer">
          <button id="leave-room-btn" class="btn btn-ghost">Leave Room</button>
        </footer>
      </div>

      <div class="error-toast hidden" id="error-toast"></div>
    `;
  }

  // ============================================================================
  // Styles
  // ============================================================================

  private attachStyles(): void {
    if (document.getElementById('lobby-styles')) return;

    const style = document.createElement('style');
    style.id = 'lobby-styles';
    style.textContent = `
      .lobby-screen {
        position: fixed;
        inset: 0;
        background: ${THEME.bgPrimary};
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
      }

      .lobby-container {
        width: 100%;
        max-width: 600px;
        padding: 2rem;
        display: flex;
        flex-direction: column;
        gap: 2rem;
      }

      .lobby-header {
        text-align: center;
      }

      .lobby-header h1 {
        font-size: 2.5rem;
        font-weight: 700;
        background: linear-gradient(135deg, ${THEME.accentPrimary}, ${THEME.accentSecondary});
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin-bottom: 0.5rem;
      }

      .lobby-header .subtitle {
        color: ${THEME.textSecondary};
        font-size: 1.1rem;
      }

      .server-status {
        margin-top: 1rem;
        font-size: 0.9rem;
      }

      .status-online {
        color: ${THEME.accentSuccess};
      }

      .status-offline {
        color: ${THEME.accentError};
      }

      .lobby-content {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .lobby-section {
        background: ${THEME.bgSecondary};
        border-radius: 12px;
        padding: 1.5rem;
      }

      .lobby-section h2 {
        font-size: 1.2rem;
        margin-bottom: 1rem;
        color: ${THEME.textPrimary};
      }

      .input-group {
        display: flex;
        gap: 0.75rem;
      }

      .input-group input {
        flex: 1;
        padding: 0.75rem 1rem;
        background: ${THEME.bgTertiary};
        border: 1px solid transparent;
        border-radius: 8px;
        color: ${THEME.textPrimary};
        font-size: 1rem;
        outline: none;
        transition: border-color 0.2s;
      }

      .input-group input:focus {
        border-color: ${THEME.accentPrimary};
      }

      .input-group input::placeholder {
        color: ${THEME.textSecondary};
      }

      .lobby-divider {
        display: flex;
        align-items: center;
        gap: 1rem;
        color: ${THEME.textSecondary};
      }

      .lobby-divider::before,
      .lobby-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: ${THEME.bgTertiary};
      }

      .btn {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-primary {
        background: linear-gradient(135deg, ${THEME.accentPrimary}, ${THEME.accentSecondary});
        color: white;
      }

      .btn-primary:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(0, 212, 255, 0.3);
      }

      .btn-secondary {
        background: ${THEME.bgTertiary};
        color: ${THEME.textPrimary};
      }

      .btn-secondary:hover:not(:disabled) {
        background: #252535;
      }

      .btn-ghost {
        background: transparent;
        color: ${THEME.textSecondary};
      }

      .btn-ghost:hover {
        color: ${THEME.textPrimary};
      }

      .btn-large {
        padding: 1rem 2rem;
        font-size: 1.1rem;
        width: 100%;
      }

      .lobby-footer {
        text-align: center;
      }

      .offline-message {
        text-align: center;
      }

      .offline-message p {
        color: ${THEME.textSecondary};
        margin-bottom: 0.5rem;
      }

      .offline-message button {
        margin-top: 1rem;
      }

      /* Room View Styles */
      .room-view .lobby-content {
        gap: 2rem;
      }

      .players-section h2 {
        font-size: 1.2rem;
        margin-bottom: 1rem;
        color: ${THEME.textPrimary};
      }

      .players-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.75rem;
      }

      .player-card {
        background: ${THEME.bgSecondary};
        border-radius: 8px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        border: 2px solid transparent;
        transition: all 0.2s;
      }

      .player-card.local {
        border-color: ${THEME.accentPrimary};
      }

      .player-card.ready {
        background: rgba(0, 255, 136, 0.1);
        border-color: ${THEME.accentSuccess};
      }

      .player-card.empty {
        background: ${THEME.bgTertiary};
        opacity: 0.5;
        color: ${THEME.textSecondary};
        justify-content: center;
        align-items: center;
        font-style: italic;
      }

      .player-name {
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .player-status {
        font-size: 0.85rem;
        color: ${THEME.textSecondary};
      }

      .badge {
        font-size: 0.7rem;
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
        font-weight: 600;
        text-transform: uppercase;
      }

      .badge.host {
        background: ${THEME.accentWarning};
        color: black;
      }

      .badge.you {
        background: ${THEME.accentPrimary};
        color: black;
      }

      .song-select-section,
      .selected-song,
      .waiting-song {
        background: ${THEME.bgSecondary};
        border-radius: 12px;
        padding: 1.5rem;
      }

      .song-select-section h3,
      .selected-song h3 {
        font-size: 1rem;
        margin-bottom: 1rem;
        color: ${THEME.textSecondary};
      }

      .song-dropdown,
      .difficulty-dropdown {
        width: 100%;
        padding: 0.75rem 1rem;
        background: ${THEME.bgTertiary};
        border: 1px solid transparent;
        border-radius: 8px;
        color: ${THEME.textPrimary};
        font-size: 1rem;
        cursor: pointer;
        margin-bottom: 0.75rem;
      }

      .song-dropdown:focus,
      .difficulty-dropdown:focus {
        border-color: ${THEME.accentPrimary};
        outline: none;
      }

      .waiting-song {
        text-align: center;
        color: ${THEME.textSecondary};
        font-style: italic;
      }

      .selected-song p {
        font-size: 1.1rem;
        margin-bottom: 0.25rem;
      }

      .selected-song .difficulty {
        color: ${THEME.accentPrimary};
        font-weight: 600;
      }

      .room-actions {
        text-align: center;
      }

      .error-toast {
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        background: ${THEME.accentError};
        color: white;
        padding: 1rem 2rem;
        border-radius: 8px;
        font-weight: 600;
        z-index: 1000;
        animation: slideUp 0.3s ease;
      }

      .error-toast.hidden {
        display: none;
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translate(-50%, 20px);
        }
        to {
          opacity: 1;
          transform: translate(-50%, 0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  private attachEventListeners(): void {
    if (!this.element) return;

    // Back button
    const backBtn = this.element.querySelector('#back-btn');
    backBtn?.addEventListener('click', () => {
      this.disconnect();
      this.clearRoomFromUrl();
      this.callbacks.onCancel();
    });

    // Retry connection button
    const retryBtn = this.element.querySelector('#retry-connection-btn');
    retryBtn?.addEventListener('click', async () => {
      this.serverAvailable = await checkServerHealth();
      this.render();
    });

    // Create room button
    const createRoomBtn = this.element.querySelector('#create-room-btn');
    createRoomBtn?.addEventListener('click', () => {
      const nameInput = this.element?.querySelector('#player-name') as HTMLInputElement;
      const name = nameInput?.value.trim();
      if (!name) {
        this.showError('Please enter your name');
        return;
      }
      this.createRoom(name);
    });

    // Join room button
    const joinRoomBtn = this.element.querySelector('#join-room-btn');
    joinRoomBtn?.addEventListener('click', () => {
      const nameInput = this.element?.querySelector('#join-player-name') as HTMLInputElement;
      const codeInput = this.element?.querySelector('#room-code') as HTMLInputElement;
      const name = nameInput?.value.trim();
      const code = codeInput?.value.trim().toUpperCase();

      if (!name) {
        this.showError('Please enter your name');
        return;
      }
      if (!code || code.length !== 8) {
        this.showError('Please enter a valid 8-character room code');
        return;
      }
      this.joinRoom(code, name);
    });

    // Leave room button
    const leaveRoomBtn = this.element.querySelector('#leave-room-btn');
    leaveRoomBtn?.addEventListener('click', () => {
      multiplayerClient.leaveRoom();
      this.clearRoomFromUrl();
      this.render();
    });

    // Ready button
    const readyBtn = this.element.querySelector('#ready-btn');
    readyBtn?.addEventListener('click', () => {
      multiplayerClient.toggleReady();
    });

    // Song select
    const songSelect = this.element.querySelector('#song-select') as HTMLSelectElement;
    songSelect?.addEventListener('change', () => {
      this.updateDifficultyDropdown(songSelect.value);
    });

    // Difficulty select
    const difficultySelect = this.element.querySelector('#difficulty-select') as HTMLSelectElement;
    difficultySelect?.addEventListener('change', () => {
      const songId = songSelect?.value;
      const difficulty = difficultySelect.value as Difficulty;
      if (songId && difficulty) {
        multiplayerClient.selectSong(songId, difficulty);
      }
    });

    // Start game button
    const startGameBtn = this.element.querySelector('#start-game-btn');
    startGameBtn?.addEventListener('click', () => {
      multiplayerClient.startGame();
    });

    // Initialize difficulty dropdown if song is selected
    if (songSelect?.value) {
      this.updateDifficultyDropdown(songSelect.value);
    }
  }

  /**
   * Update difficulty dropdown based on selected song
   */
  private updateDifficultyDropdown(songId: string): void {
    const difficultySelect = this.element?.querySelector('#difficulty-select') as HTMLSelectElement;
    if (!difficultySelect) return;

    const song = this.songs.find((s) => s.id === songId);
    if (!song) {
      difficultySelect.innerHTML = '<option value="">-- Select difficulty --</option>';
      return;
    }

    difficultySelect.innerHTML =
      '<option value="">-- Select difficulty --</option>' +
      song.charts
        .map(
          (chart) => `
        <option value="${chart.difficulty}">${chart.difficulty} (${chart.level})</option>
      `
        )
        .join('');
  }

  // ============================================================================
  // Room Actions
  // ============================================================================

  private async createRoom(playerName: string): Promise<void> {
    try {
      await multiplayerClient.connect();
      multiplayerClient.createRoom(playerName);
    } catch (err) {
      this.showError('Failed to connect to server');
    }
  }

  private async joinRoom(roomCode: string, playerName: string): Promise<void> {
    try {
      await multiplayerClient.connect();
      multiplayerClient.joinRoom(roomCode, playerName);
    } catch (err) {
      this.showError('Failed to connect to server');
    }
  }

  private disconnect(): void {
    multiplayerClient.disconnect();
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private handleMultiplayerEvent(event: MultiplayerEvent): void {
    switch (event.type) {
      case 'room-created':
      case 'room-joined':
        // Update URL with room code for easy sharing
        this.updateUrlWithRoom();
        this.render();
        break;

      case 'room-updated':
      case 'player-joined':
      case 'player-left':
        this.render();
        break;

      case 'game-starting':
        // Show countdown overlay
        this.showCountdown(event.data as { startTime: number });
        break;

      case 'game-started':
        const room = multiplayerClient.getRoom();
        if (room?.songId && room?.difficulty) {
          this.callbacks.onStartGame(room.songId, room.difficulty);
        }
        break;

      case 'error':
        this.showError(event.data as string);
        break;
    }
  }

  // ============================================================================
  // URL Management
  // ============================================================================

  /**
   * Update URL to include room code for sharing
   */
  private updateUrlWithRoom(): void {
    const room = multiplayerClient.getRoom();
    if (room?.code) {
      const url = new URL(window.location.href);
      url.searchParams.set('room', room.code);
      window.history.replaceState({}, '', url.toString());
    }
  }

  /**
   * Clear room code from URL
   */
  private clearRoomFromUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
  }

  // ============================================================================
  // UI Helpers
  // ============================================================================

  private updateUI(): void {
    // Update UI based on current state
  }

  private showError(message: string): void {
    const toast = this.element?.querySelector('#error-toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.remove('hidden');
      setTimeout(() => {
        toast.classList.add('hidden');
      }, 3000);
    }
  }

  private showCountdown(data: { startTime: number }): void {
    const overlay = document.createElement('div');
    overlay.className = 'countdown-overlay';
    overlay.innerHTML = `
      <div class="countdown-content">
        <div class="countdown-number" id="countdown-number">5</div>
        <div class="countdown-text">Get Ready!</div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .countdown-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .countdown-content {
        text-align: center;
      }

      .countdown-number {
        font-size: 8rem;
        font-weight: 700;
        background: linear-gradient(135deg, ${THEME.accentPrimary}, ${THEME.accentSecondary});
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: pulse 1s ease-in-out infinite;
      }

      .countdown-text {
        font-size: 1.5rem;
        color: ${THEME.textSecondary};
        margin-top: 1rem;
      }

      @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    const numberEl = overlay.querySelector('#countdown-number')!;
    const updateCountdown = () => {
      const remaining = Math.ceil((data.startTime - Date.now()) / 1000);
      if (remaining <= 0) {
        overlay.remove();
      } else {
        numberEl.textContent = remaining.toString();
        requestAnimationFrame(updateCountdown);
      }
    };
    updateCountdown();
  }
}
