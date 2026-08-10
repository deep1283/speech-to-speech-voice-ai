declare module 'opus-recorder' {
  interface RecorderConfig {
    encoderPath?: string;
    decoderPath?: string;
    mediaTrackConstraints?: MediaTrackConstraints;
    bufferLength?: number;
    encoderApplication?: number;
    encoderFrameSize?: number;
    encoderSampleRate?: number;
    maxFramesPerPage?: number;
    numberOfChannels?: number;
    recordingGain?: number;
    resampleQuality?: number;
    encoderComplexity?: number;
    streamPages?: boolean;
    sourceNode?: MediaStreamAudioSourceNode;
  }

  class Recorder {
    constructor(config?: RecorderConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    pause(): void;
    resume(): void;
    close(): void;
    ondataavailable: ((data: ArrayBuffer) => void) | null;
    onstop: (() => void) | null;
    onstart: (() => void) | null;
    onpause: (() => void) | null;
    onresume: (() => void) | null;
    encodedSamplePosition: number;
    static isRecordingSupported(): boolean;
  }

  export default Recorder;
}
