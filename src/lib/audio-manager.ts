/**
 * AudioManager - Unified Audio Engine for Moshi Speech Client.
 * Manages a SINGLE shared WebAudio AudioContext for both microphone capture
 * and speaker playback. This allows Chrome/macOS Hardware Acoustic Echo Cancellation (AEC)
 * to cancel Moshi's speaker output from the microphone input signal, preventing
 * feedback loops and repeated answers ("yes i do, i speak english").
 */

import Recorder from 'opus-recorder';

export interface AudioManagerOptions {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  /**
   * Returns true while speaker output must not be sent back to the model.
   * This is a last line of defence when browser AEC cannot fully remove
   * speaker audio (for example with external speakers or headphones).
   */
  shouldSuppressMicrophone?: () => boolean;
  onSpeakingStateChange?: (isSpeaking: boolean) => void;
  onError?: (error: Error) => void;
}

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micAnalyserNode: AnalyserNode | null = null;
  private silentMicGainNode: GainNode | null = null;

  private speakerGainNode: GainNode | null = null;
  private speakerAnalyserNode: AnalyserNode | null = null;
  private workletNode: AudioWorkletNode | null = null;

  private recorder: Recorder | null = null;
  private decoderWorker: Worker | null = null;

  private isInitialized = false;
  private isRecording = false;
  private isSpeaking = false;
  private silenceCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private options: AudioManagerOptions) {}

  /**
   * Initialize shared AudioContext, Playback Worklet, and WASM Decoder.
   * Must be called after user gesture.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // 1. Create single shared AudioContext at system default sample rate (e.g. 48kHz / 44.1kHz)
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx({
        latencyHint: 'interactive',
      });

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const sampleRate = this.audioContext.sampleRate;

      // 2. Playback Pipeline: Worklet -> Gain -> Analyser -> Destination
      this.speakerGainNode = this.audioContext.createGain();
      this.speakerGainNode.gain.value = 1.0;

      this.speakerAnalyserNode = this.audioContext.createAnalyser();
      this.speakerAnalyserNode.fftSize = 256;
      this.speakerAnalyserNode.smoothingTimeConstant = 0.7;

      await this.audioContext.audioWorklet.addModule('/sam-processor.worklet.js');
      this.workletNode = new AudioWorkletNode(this.audioContext, 'sam-audio-processor', {
        outputChannelCount: [1],
      });

      this.workletNode.connect(this.speakerGainNode);
      this.speakerGainNode.connect(this.speakerAnalyserNode);
      this.speakerAnalyserNode.connect(this.audioContext.destination);

      // The worklet reports buffer activity, including silent frames. Speaking
      // state is instead derived from decoded signal level below.
      this.workletNode.port.onmessage = () => {};

      // 3. WASM Opus Decoder Worker Setup
      this.decoderWorker = new Worker('/decoderWorker.min.js');

      this.decoderWorker.onmessage = (event: MessageEvent) => {
        if (!event.data) return;
        const decodedBuffers = event.data as Float32Array[];
        if (decodedBuffers.length > 0 && decodedBuffers[0] && decodedBuffers[0].length > 0) {
          const pcmFrame = decodedBuffers[0];
          if (this.isAudible(pcmFrame)) {
            this.updateSpeakingState(true);
            this.scheduleSilenceCheck();
          }
          if (this.workletNode) {
            this.workletNode.port.postMessage({
              frame: pcmFrame,
              type: 'audio',
            });
          }
        }
      };

      const bufferLength = Math.round(960 * sampleRate / 24000);
      this.decoderWorker.postMessage({
        command: 'init',
        bufferLength: bufferLength,
        decoderSampleRate: 24000,           // Moshi outputs Opus 24kHz
        outputBufferSampleRate: sampleRate, // Resample to shared AudioContext rate
        resampleQuality: 0,
      });

      this.isInitialized = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.options.onError) {
        this.options.onError(error);
      } else {
        throw error;
      }
    }
  }

  /**
   * Start microphone capture using the shared AudioContext so WebAudio AEC works.
   */
  public async startMicrophone(): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }

    if (this.isRecording || !this.audioContext) return;

    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: this.options.echoCancellation ?? true,
          noiseSuppression: this.options.noiseSuppression ?? true,
          autoGainControl: this.options.autoGainControl ?? true,
          channelCount: 1,
        },
        video: false,
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Attach microphone to shared AudioContext
      this.micSourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.micAnalyserNode = this.audioContext.createAnalyser();
      this.micAnalyserNode.fftSize = 256;
      this.micAnalyserNode.smoothingTimeConstant = 0.8;

      this.micSourceNode.connect(this.micAnalyserNode);

      // Silent gain node to keep mic graph active without feeding back to speakers
      const silentGain = this.audioContext.createGain();
      silentGain.gain.value = 0;
      this.micAnalyserNode.connect(silentGain);
      silentGain.connect(this.audioContext.destination);
      this.silentMicGainNode = silentGain;

      // Follow Moshi's reference client: let opus-recorder own the capture
      // source used for encoding. Passing our analyser source node here can
      // prevent the recorder worklet from producing a decodable Ogg stream in
      // Chrome. The separate source above remains only for visualization.
      const sampleRate = this.audioContext.sampleRate;
      const bufferLength = Math.round(960 * sampleRate / 24000);

      const recorderConfig = {
        mediaTrackConstraints: constraints.audio as MediaTrackConstraints,
        encoderPath: '/encoderWorker.min.js',
        bufferLength,
        encoderFrameSize: 20,
        encoderSampleRate: 24000,
        maxFramesPerPage: 2,
        numberOfChannels: 1,
        recordingGain: 1,
        resampleQuality: 3,
        encoderComplexity: 0,
        encoderApplication: 2049,
        streamPages: true,
      };

      this.recorder = new Recorder(recorderConfig);

      this.recorder.ondataavailable = (data: ArrayBuffer) => {
        if (
          this.isRecording &&
          !this.options.shouldSuppressMicrophone?.() &&
          this.options.onAudioChunk
        ) {
          this.options.onAudioChunk(data);
        }
      };

      this.isRecording = true;
      await this.recorder.start();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.stopMicrophone();
      if (this.options.onError) {
        this.options.onError(error);
      } else {
        throw error;
      }
    }
  }

  /**
   * Stop microphone capture.
   */
  public stopMicrophone(): void {
    this.isRecording = false;

    if (this.recorder) {
      try {
        this.recorder.stop();
      } catch {}
      this.recorder = null;
    }

    if (this.micSourceNode) {
      this.micSourceNode.disconnect();
      this.micSourceNode = null;
    }

    if (this.micAnalyserNode) {
      this.micAnalyserNode.disconnect();
      this.micAnalyserNode = null;
    }

    if (this.silentMicGainNode) {
      this.silentMicGainNode.disconnect();
      this.silentMicGainNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  /**
   * Feed an incoming Ogg/Opus audio chunk from Moshi server to WASM decoder.
   */
  public playChunk(opusData: ArrayBuffer): void {
    if (!this.isInitialized || !this.decoderWorker) return;

    const pages = new Uint8Array(opusData);
    this.decoderWorker.postMessage(
      { command: 'decode', pages: pages },
      [pages.buffer]
    );
  }

  /**
   * Reset playback worklet.
   */
  public resetPlayback(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'reset' });
    }
    this.updateSpeakingState(false);
  }

  public getMicAnalyser(): AnalyserNode | null {
    return this.micAnalyserNode;
  }

  public getSpeakerAnalyser(): AnalyserNode | null {
    return this.speakerAnalyserNode;
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  public stop(): void {
    this.stopMicrophone();

    if (this.silenceCheckTimer) {
      clearTimeout(this.silenceCheckTimer);
      this.silenceCheckTimer = null;
    }

    if (this.decoderWorker) {
      this.decoderWorker.postMessage({ command: 'done' });
      this.decoderWorker.terminate();
      this.decoderWorker = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.speakerGainNode) {
      this.speakerGainNode.disconnect();
      this.speakerGainNode = null;
    }

    if (this.speakerAnalyserNode) {
      this.speakerAnalyserNode.disconnect();
      this.speakerAnalyserNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.isInitialized = false;
    this.updateSpeakingState(false);
  }

  private scheduleSilenceCheck(): void {
    if (this.silenceCheckTimer) {
      clearTimeout(this.silenceCheckTimer);
    }
    this.silenceCheckTimer = setTimeout(() => {
      this.updateSpeakingState(false);
    }, 500);
  }

  /**
   * Moshi sends audio packets continuously, including silence. Only gate the
   * microphone for audible output; otherwise a silent stream blocks every
   * later user turn.
   */
  private isAudible(frame: Float32Array): boolean {
    let energy = 0;
    for (let index = 0; index < frame.length; index++) {
      energy += frame[index] * frame[index];
    }
    const rms = Math.sqrt(energy / frame.length);
    return rms >= 0.003;
  }

  private updateSpeakingState(speaking: boolean): void {
    if (this.isSpeaking !== speaking) {
      this.isSpeaking = speaking;
      if (this.options.onSpeakingStateChange) {
        this.options.onSpeakingStateChange(speaking);
      }
    }
  }

  public setVolume(volume: number): void {
    if (this.speakerGainNode) {
      this.speakerGainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }
}
