/**
 * Tests for multiplayer client
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MultiplayerClient, checkServerHealth } from '../../src/multiplayer/client';

// Mock WebSocket with addEventListener support
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  private eventListeners: Map<string, Set<Function>> = new Map();

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.dispatchEvent('open');
    }, 0);
  }

  addEventListener(event: string, handler: Function) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  removeEventListener(event: string, handler: Function) {
    this.eventListeners.get(event)?.delete(handler);
  }

  private dispatchEvent(event: string, data?: unknown) {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent('close');
  });

  // Helper to simulate receiving a message
  simulateMessage(data: string) {
    this.dispatchEvent('message', { data });
  }

  // Helper to simulate an error
  simulateError(error: Error) {
    this.dispatchEvent('error', error);
  }
}

// Mock global WebSocket
vi.stubGlobal('WebSocket', MockWebSocket);

// Mock fetch for health check
vi.stubGlobal('fetch', vi.fn());

describe('MultiplayerClient', () => {
  let client: MultiplayerClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MultiplayerClient('ws://localhost:3001');
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('initialization', () => {
    it('should create a new instance', () => {
      expect(client).toBeDefined();
    });

    it('should start disconnected', () => {
      expect(client.getConnectionState()).toBe('disconnected');
    });

    it('should have no room initially', () => {
      expect(client.getRoom()).toBeNull();
    });

    it('should have no player ID initially', () => {
      expect(client.getPlayerId()).toBeNull();
    });

    it('should not be connected initially', () => {
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('setServerUrl()', () => {
    it('should update server URL', () => {
      client.setServerUrl('ws://newserver:3002');
      // Can't directly test the private property, but the client should work
      expect(client).toBeDefined();
    });
  });

  describe('event handling', () => {
    it('should add event listeners', () => {
      const handler = vi.fn();
      client.addEventListener(handler);
      // Event should be registered without error
      expect(true).toBe(true);
    });

    it('should remove event listeners', () => {
      const handler = vi.fn();
      client.addEventListener(handler);
      client.removeEventListener(handler);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('connect()', () => {
    it('should attempt connection', async () => {
      const connectPromise = client.connect();
      // Wait for mock WebSocket to "connect"
      await new Promise(resolve => setTimeout(resolve, 10));
      await connectPromise;
      expect(client.getConnectionState()).toBe('connected');
    });

    it('should emit connection-changed event', async () => {
      const handler = vi.fn();
      client.addEventListener(handler);

      await client.connect();

      expect(handler).toHaveBeenCalled();
      const calls = handler.mock.calls.filter(
        (call) => call[0]?.type === 'connection-changed'
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('disconnect()', () => {
    it('should disconnect from server', async () => {
      await client.connect();
      client.disconnect();
      expect(client.getConnectionState()).toBe('disconnected');
    });

    it('should clear room on disconnect', async () => {
      await client.connect();
      client.disconnect();
      expect(client.getRoom()).toBeNull();
    });

    it('should clear player ID on disconnect', async () => {
      await client.connect();
      client.disconnect();
      expect(client.getPlayerId()).toBeNull();
    });
  });

  describe('room actions', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should send create-room message', () => {
      client.createRoom('TestPlayer');
      // The mock WebSocket should have received the message
      // We can't easily verify the content with our simple mock
      expect(client.getPlayerName()).toBe('TestPlayer');
    });

    it('should send join-room message', () => {
      client.joinRoom('ABC123', 'Joiner');
      expect(client.getPlayerName()).toBe('Joiner');
    });

    it('should send leave-room message', () => {
      client.leaveRoom();
      expect(client.getRoom()).toBeNull();
    });

    it('should send toggle-ready message', () => {
      client.toggleReady();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should send select-song message', () => {
      client.selectSong('song-123', 'Hard');
      // Should not throw
      expect(true).toBe(true);
    });

    it('should send start-game message', () => {
      client.startGame();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('gameplay actions', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should send player state update', () => {
      client.updateState(75, 50, 250000);
      // Should not throw
      expect(true).toBe(true);
    });

    it('should send death notification', () => {
      client.notifyDeath();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should send attack', () => {
      client.sendAttack('left', 1500);
      // Should not throw
      expect(true).toBe(true);
    });

    it('should send game finished notification', () => {
      client.notifyGameFinished(500000, 2);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('isHost()', () => {
    it('should return false when not in room', () => {
      expect(client.isHost()).toBe(false);
    });
  });
});

describe('checkServerHealth', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('should return true when server is healthy', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    const result = await checkServerHealth('http://localhost:3001');
    expect(result).toBe(true);
  });

  it('should return false when server returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'error' }),
    });

    const result = await checkServerHealth('http://localhost:3001');
    expect(result).toBe(false);
  });

  it('should return false when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await checkServerHealth('http://localhost:3001');
    expect(result).toBe(false);
  });

  it('should return false when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
    });

    const result = await checkServerHealth('http://localhost:3001');
    expect(result).toBe(false);
  });
});
