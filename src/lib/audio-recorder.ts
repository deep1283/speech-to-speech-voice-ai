/**
 * AudioRecorder - Captures microphone audio and encodes it as Ogg/Opus
 * using the opus-recorder library (WASM-based).
 * Matches the official Moshi client protocol:
 * - 24kHz Opus encoding
 * - 20ms frames
 * - Streaming Ogg pages
 */
import Recorder from 'opus-recorder';

export interface AudioRecorderOptions {
  targetSampleRate: number; // 24000 for Moshi
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  onAudioChunk: (chunk: ArrayBuffer) => void;
  onError?: (error: Error) => void;
}

export class AudioRecorder {
  private recorder: Recorder | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private isRecording = false;

  constructor(private options: AudioRecorderOptions) {}

  public async start(): Promise<void> {
    if (this.isRecording) return;

    try {
      // 1. Get microphone stream with echo cancellation
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

      // 2. Create AudioContext for analyser
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx();

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // 3. Create analyser node for visualizer
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.sourceNode.connect(this.analyserNode);
      // Connect to silent output to keep alive
      const silentGain = this.audioContext.createGain();
      silentGain.gain.value = 0;
      this.analyserNode.connect(silentGain);
      silentGain.connect(this.audioContext.destination);

      // 4. Create opus-recorder with matching Moshi config
      // bufferLength must be scaled to match 960 samples at 24kHz relative to AudioContext's sample rate
      const bufferLength = Math.round(960 * this.audioContext.sampleRate / 24000);
      
      const recorderConfig = {
        mediaTrackConstraints: constraints.audio as MediaTrackConstraints,
        encoderPath: '/encoderWorker.min.js',
        bufferLength,
        encoderFrameSize: 20,           // 20ms frames
        encoderSampleRate: 24000,       // Moshi expects 24kHz
        maxFramesPerPage: 2,            // Small pages for low latency
        numberOfChannels: 1,
        recordingGain: 1,
        resampleQuality: 3,
        encoderComplexity: 0,           // Fast encoding
        encoderApplication: 2049,       // OPUS_APPLICATION_VOIP
        streamPages: true,              // Critical: stream Ogg pages as they're ready
        sourceNode: this.sourceNode,    // Reuse existing mic source
      };

      this.recorder = new Recorder(recorderConfig);

      // 5. Handle encoded Ogg/Opus page data
      this.recorder.ondataavailable = (data: ArrayBuffer) => {
        if (this.isRecording && this.options.onAudioChunk) {
          this.options.onAudioChunk(data);
        }
      };

      // 6. Start recording
      await this.recorder.start();
      this.isRecording = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.stop();
      if (this.options.onError) {
        this.options.onError(error);
      } else {
        throw error;
      }
    }
  }

  public stop(): void {
    this.isRecording = false;

    if (this.recorder) {
      try {
        this.recorder.stop();
      } catch {}
      this.recorder = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }
}
