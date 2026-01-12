/**
 * Integration tests for multiplayer WebSocket server
 * Tests host-navigation synchronization
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { setTimeout as delay } from 'timers/promises';

const SERVER_PORT = 3099; // Use different port for tests
const SERVER_URL = `ws://localhost:${SERVER_PORT}`;

let serverProcess: ChildProcess | null = null;

// Helper to create a WebSocket client
function createClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// Helper to send message and wait for response
function sendAndReceive(ws: WebSocket, message: object, expectedType?: string): Promise<object> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for response')), 5000);

    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (!expectedType || msg.type === expectedType) {
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(msg);
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });
}

// Helper to wait for a specific message type
function waitForMessage(ws: WebSocket, expectedType: string): Promise<object> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), 5000);

    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === expectedType) {
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(msg);
      }
    };

    ws.on('message', handler);
  });
}

describe('Multiplayer Server - Host Navigation', () => {
  beforeAll(async () => {
    // Start server on test port
    serverProcess = spawn('node', ['server/index.js'], {
      env: { ...process.env, PORT: SERVER_PORT.toString() },
      stdio: 'pipe',
    });

    // Wait for server to start
    await delay(1000);
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await delay(500);
    }
  });

  describe('host-navigation message', () => {
    let hostWs: WebSocket;
    let guestWs: WebSocket;
    let roomCode: string;

    beforeEach(async () => {
      // Create host
      hostWs = await createClient();
      const createResponse = await sendAndReceive(hostWs, {
        type: 'create-room',
        playerName: 'TestHost',
      }, 'room-created') as { room: { code: string } };

      roomCode = createResponse.room.code;

      // Create guest
      guestWs = await createClient();
    });

    afterEach(() => {
      hostWs?.close();
      guestWs?.close();
    });

    it('should broadcast host navigation to guests', async () => {
      // Guest joins room
      const joinPromise = sendAndReceive(guestWs, {
        type: 'join-room',
        roomCode,
        playerName: 'TestGuest',
      }, 'room-joined');

      await joinPromise;

      // Set up listener for navigation on guest
      const navPromise = waitForMessage(guestWs, 'host-navigation');

      // Host sends navigation
      hostWs.send(JSON.stringify({
        type: 'host-navigation',
        navigation: {
          packIndex: 2,
          songIndex: 5,
          songId: 'test-song-123',
          difficulty: 'Hard',
        },
      }));

      // Guest should receive navigation
      const navMsg = await navPromise as { navigation: { packIndex: number; songIndex: number; songId: string } };
      expect(navMsg.navigation.packIndex).toBe(2);
      expect(navMsg.navigation.songIndex).toBe(5);
      expect(navMsg.navigation.songId).toBe('test-song-123');
    });

    it('should include hostNavigation when guest joins existing room', async () => {
      // Host sends navigation before guest joins
      hostWs.send(JSON.stringify({
        type: 'host-navigation',
        navigation: {
          packIndex: 1,
          songIndex: 3,
          songId: 'pre-selected-song',
          difficulty: 'Medium',
        },
      }));

      await delay(100);

      // Guest joins - should receive current navigation
      const joinResponse = await sendAndReceive(guestWs, {
        type: 'join-room',
        roomCode,
        playerName: 'LateGuest',
      }, 'room-joined') as { hostNavigation?: { packIndex: number; songIndex: number } };

      expect(joinResponse.hostNavigation).toBeDefined();
      expect(joinResponse.hostNavigation!.packIndex).toBe(1);
      expect(joinResponse.hostNavigation!.songIndex).toBe(3);
    });

    it('should not allow guests to send navigation', async () => {
      // Guest joins
      await sendAndReceive(guestWs, {
        type: 'join-room',
        roomCode,
        playerName: 'TestGuest',
      }, 'room-joined');

      // Set up listener on host (should NOT receive anything)
      let receivedNav = false;
      hostWs.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'host-navigation') {
          receivedNav = true;
        }
      });

      // Guest tries to send navigation (should be ignored by server)
      guestWs.send(JSON.stringify({
        type: 'host-navigation',
        navigation: {
          packIndex: 99,
          songIndex: 99,
        },
      }));

      await delay(500);
      expect(receivedNav).toBe(false);
    });
  });

  describe('room creation and joining', () => {
    it('should create room with host', async () => {
      const ws = await createClient();

      const response = await sendAndReceive(ws, {
        type: 'create-room',
        playerName: 'HostPlayer',
      }, 'room-created') as { room: { code: string; players: Array<{ isHost: boolean }> }; playerId: string };

      expect(response.room.code).toHaveLength(8); // Room codes are now 8 chars for better security
      expect(response.room.players).toHaveLength(1);
      expect(response.room.players[0].isHost).toBe(true);
      expect(response.playerId).toBeDefined();

      ws.close();
    });

    it('should allow guest to join room', async () => {
      // Create host
      const hostWs = await createClient();
      const createResponse = await sendAndReceive(hostWs, {
        type: 'create-room',
        playerName: 'Host',
      }, 'room-created') as { room: { code: string } };

      // Join as guest
      const guestWs = await createClient();
      const joinResponse = await sendAndReceive(guestWs, {
        type: 'join-room',
        roomCode: createResponse.room.code,
        playerName: 'Guest',
      }, 'room-joined') as { room: { players: Array<{ name: string }> } };

      expect(joinResponse.room.players).toHaveLength(2);
      expect(joinResponse.room.players.map(p => p.name)).toContain('Host');
      expect(joinResponse.room.players.map(p => p.name)).toContain('Guest');

      hostWs.close();
      guestWs.close();
    });
  });

  describe('input validation', () => {
    it('should reject empty player name', async () => {
      const ws = await createClient();

      const response = await sendAndReceive(ws, {
        type: 'create-room',
        playerName: '',
      }, 'error') as { message: string };

      expect(response.message).toContain('empty');

      ws.close();
    });

    it('should reject player name with HTML tags (XSS prevention)', async () => {
      const ws = await createClient();

      const response = await sendAndReceive(ws, {
        type: 'create-room',
        playerName: '<script>alert(1)</script>',
      }, 'error') as { message: string };

      expect(response.message).toContain('invalid');

      ws.close();
    });

    it('should reject invalid room code format', async () => {
      const ws = await createClient();

      const response = await sendAndReceive(ws, {
        type: 'join-room',
        roomCode: 'abc', // Too short
        playerName: 'TestPlayer',
      }, 'error') as { message: string };

      expect(response.message).toContain('8 characters');

      ws.close();
    });

    it('should reject invalid navigation data', async () => {
      const ws = await createClient();

      // Create room first
      await sendAndReceive(ws, {
        type: 'create-room',
        playerName: 'Host',
      }, 'room-created');

      // Try to send invalid navigation
      const response = await sendAndReceive(ws, {
        type: 'host-navigation',
        navigation: {
          packIndex: -1, // Invalid: negative index
          songIndex: 0,
        },
      }, 'error') as { message: string };

      expect(response.message).toContain('Invalid');

      ws.close();
    });
  });
});
