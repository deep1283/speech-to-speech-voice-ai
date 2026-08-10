/**
 * AudioPlayer - Plays incoming Ogg/Opus audio from Moshi server.
 * Uses the official Moshi AudioWorklet processor for low-latency
 * scheduled playback, and a WASM Opus decoder worker.
 */

export interface AudioPlayerOptions {
  sampleRate: number; // Moshi output rate (24000)
  onSpeakingStateChange?: (isSpeaking: boolean) => void;
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private decoderWorker: Worker | null = null;
  private isInitialized = false;
  private isSpeaking = false;
  private silenceCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private options: AudioPlayerOptions) {}

  /**
   * Initialize audio context, worklet processor, and decoder worker.
   * Must be called after a user gesture (click).
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    // 1. Create AudioContext
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioCtx({
      sampleRate: this.options.sampleRate,
      latencyHint: 'interactive',
    });

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const currentSampleRate = this.audioContext.sampleRate;

    // 2. Create gain and analyser nodes
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.7;

    // 3. Load the Moshi AudioWorklet processor for scheduled playback
    await this.audioContext.audioWorklet.addModule('/moshi-processor.worklet.js');
    this.workletNode = new AudioWorkletNode(this.audioContext, 'moshi-processor', {
      outputChannelCount: [1],
    });

    // Connect: Worklet -> Gain -> Analyser -> Destination
    this.workletNode.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);

    // Track speaking state from worklet messages
    this.workletNode.port.onmessage = () => {
      this.updateSpeakingState(true);
      this.scheduleSilenceCheck();
    };

    // 4. Create the WASM Opus decoder worker
    this.decoderWorker = new Worker('/decoderWorker.min.js');
    
    this.decoderWorker.onmessage = (event: MessageEvent) => {
      if (!event.data) return;

      // Decoder worker outputs array of Float32Array channels: event.data[0] is mono channel 0
      const decodedBuffers = event.data as Float32Array[];
      if (decodedBuffers.length > 0 && decodedBuffers[0] && decodedBuffers[0].length > 0) {
        const pcmFrame = decodedBuffers[0];
        // Send decoded Float32Array frame to the Moshi worklet processor for scheduled playback
        if (this.workletNode) {
          this.workletNode.port.postMessage({
            frame: pcmFrame,
            type: 'audio',
          });
        }
      }
    };

    // Initialize decoder matching official Moshi parameters
    const bufferLength = Math.round(960 * currentSampleRate / 24000);
    this.decoderWorker.postMessage({
      command: 'init',
      bufferLength: bufferLength,
      decoderSampleRate: 24000,           // Moshi model outputs Opus 24kHz
      outputBufferSampleRate: currentSampleRate,
      resampleQuality: 0,
    });

    this.isInitialized = true;
  }

  /**
   * Feed an incoming Ogg/Opus audio chunk from the Moshi server
   * to the decoder worker. The worker decodes and sends PCM
   * to the playback worklet.
   */
  public playChunk(opusData: ArrayBuffer): void {
    if (!this.isInitialized || !this.decoderWorker) return;

    // Must wrap in Uint8Array because decoderWorker.decode() requires a TypedArray with .buffer
    const pages = new Uint8Array(opusData);
    this.decoderWorker.postMessage(
      { command: 'decode', pages: pages },
      [pages.buffer] // Zero-copy ArrayBuffer transfer
    );
  }

  /**
   * Reset the playback worklet state (clears queued buffers)
   */
  public reset(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'reset' });
    }
    this.updateSpeakingState(false);
  }

  private scheduleSilenceCheck(): void {
    if (this.silenceCheckTimer) {
      clearTimeout(this.silenceCheckTimer);
    }
    this.silenceCheckTimer = setTimeout(() => {
      // If no new data arrived, consider AI stopped speaking
      this.updateSpeakingState(false);
    }, 500);
  }

  private updateSpeakingState(speaking: boolean): void {
    if (this.isSpeaking !== speaking) {
      this.isSpeaking = speaking;
      if (this.options.onSpeakingStateChange) {
        this.options.onSpeakingStateChange(speaking);
      }
    }
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  public stop(): void {
    if (this.decoderWorker) {
      this.decoderWorker.postMessage({ command: 'done' });
      this.decoderWorker.terminate();
      this.decoderWorker = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.isInitialized = false;
    this.updateSpeakingState(false);
  }

  public setVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }
}
