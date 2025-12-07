// ============================================================================
// Audio Manager - Web Audio API wrapper for precise timing
// ============================================================================

export class AudioManager {
  private context: AudioContext | null = null;
  private currentBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;

  /** Time when playback started (in AudioContext time) */
  private playStartTime: number = 0;

  /** Offset into the audio when we started (for pause/resume) */
  private pauseOffset: number = 0;

  /** Is audio currently playing */
  private _isPlaying: boolean = false;

  /** Cache of loaded audio buffers */
  private cache: Map<string, AudioBuffer> = new Map();

  /** Duration for virtual (silent) songs in seconds */
  private static readonly VIRTUAL_SONG_DURATION = 300; // 5 minutes

  /**
   * Initialize or resume the audio context
   * Must be called after user interaction (browser policy)
   */
  async init(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    // Create gain node for volume control
    if (!this.gainNode) {
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }
  }

  /**
   * Get the AudioContext (must be initialized first)
   */
  getContext(): AudioContext {
    if (!this.context) {
      throw new Error('AudioManager not initialized. Call init() first.');
    }
    return this.context;
  }

  /**
   * Create a silent audio buffer for virtual songs
   * @param duration - Duration in seconds
   */
  private createSilentBuffer(duration: number): AudioBuffer {
    if (!this.context) {
      throw new Error('AudioManager not initialized');
    }

    const sampleRate = this.context.sampleRate;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = this.context.createBuffer(2, numSamples, sampleRate);

    // Buffer is already filled with zeros (silence)
    return buffer;
  }

  /**
   * Check if a URL points to a virtual (no audio) song
   */
  private isVirtualSong(url: string): boolean {
    return url.endsWith('/virtual') || url.endsWith('virtual.mp3') || url.endsWith('virtual.ogg');
  }

  /**
   * Load an audio file
   * @param url - URL or path to the audio file
   * @returns Promise that resolves when loaded
   */
  async load(url: string): Promise<void> {
    // Check cache
    if (this.cache.has(url)) {
      this.currentBuffer = this.cache.get(url)!;
      return;
    }

    await this.init();

    // Handle virtual songs (no actual audio file)
    if (this.isVirtualSong(url)) {
      const silentBuffer = this.createSilentBuffer(AudioManager.VIRTUAL_SONG_DURATION);
      this.cache.set(url, silentBuffer);
      this.currentBuffer = silentBuffer;
      console.log(`Loaded virtual song with ${AudioManager.VIRTUAL_SONG_DURATION}s silent audio`);
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load audio: ${url} (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.context!.decodeAudioData(arrayBuffer);

    // Cache the buffer
    this.cache.set(url, audioBuffer);
    this.currentBuffer = audioBuffer;
  }

  /**
   * Start playback
   * @param offset - Start position in seconds (default 0)
   */
  play(offset: number = 0): void {
    if (!this.context || !this.currentBuffer || !this.gainNode) {
      throw new Error('Audio not loaded');
    }

    // Stop any existing playback
    this.stopSource();

    // Create new source
    this.sourceNode = this.context.createBufferSource();
    this.sourceNode.buffer = this.currentBuffer;
    this.sourceNode.connect(this.gainNode);

    // Track timing
    this.playStartTime = this.context.currentTime;
    this.pauseOffset = offset;

    // Start playback
    this.sourceNode.start(0, offset);
    this._isPlaying = true;

    // Handle natural end of playback
    this.sourceNode.onended = () => {
      this._isPlaying = false;
    };
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this._isPlaying) return;

    // Save current position
    this.pauseOffset = this.getCurrentTime();

    // Stop the source
    this.stopSource();
    this._isPlaying = false;
  }

  /**
   * Resume playback from paused position
   */
  resume(): void {
    if (this._isPlaying) return;
    this.play(this.pauseOffset);
  }

  /**
   * Stop playback completely
   */
  stop(): void {
    this.stopSource();
    this.pauseOffset = 0;
    this._isPlaying = false;
  }

  /**
   * Internal: stop the source node
   */
  private stopSource(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // Already stopped
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  /**
   * Get current playback time in seconds
   */
  getCurrentTime(): number {
    if (!this.context || !this._isPlaying) {
      return this.pauseOffset;
    }
    return this.pauseOffset + (this.context.currentTime - this.playStartTime);
  }

  /**
   * Get current playback time in milliseconds
   */
  getCurrentTimeMs(): number {
    return this.getCurrentTime() * 1000;
  }

  /**
   * Get the audio context's current time (for sync)
   */
  getContextTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /**
   * Check if audio is playing
   */
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * Get the duration of the loaded audio in seconds
   */
  getDuration(): number {
    return this.currentBuffer?.duration ?? 0;
  }

  /**
   * Get the duration in milliseconds
   */
  getDurationMs(): number {
    return this.getDuration() * 1000;
  }

  /**
   * Set volume (0 to 1)
   */
  setVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.gainNode?.gain.value ?? 1;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.cache.clear();
    this.currentBuffer = null;

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.context) {
      this.context.close();
      this.context = null;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const audioManager = new AudioManager();
