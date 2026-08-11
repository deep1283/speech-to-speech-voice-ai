class SamAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.initialBufferSamples = Math.round(sampleRate * 0.1);
    this.targetBufferSamples = Math.round(sampleRate * 0.15);
    this.maxBufferSamples = Math.round(sampleRate * 0.4);
    this.frames = [];
    this.offset = 0;
    this.queuedSamples = 0;
    this.started = false;

    this.port.onmessage = ({ data }) => {
      if (data.type === 'reset') {
        this.reset();
        return;
      }

      if (data.type === 'audio' && data.frame instanceof Float32Array) {
        this.frames.push(data.frame);
        this.queuedSamples += data.frame.length;
        this.trimExcessBuffer();
      }
    };
  }

  reset() {
    this.frames = [];
    this.offset = 0;
    this.queuedSamples = 0;
    this.started = false;
  }

  trimExcessBuffer() {
    if (this.queuedSamples <= this.maxBufferSamples) return;

    const samplesToDrop = this.queuedSamples - this.targetBufferSamples;
    let dropped = 0;
    while (this.frames.length && dropped < samplesToDrop) {
      const available = this.frames[0].length - this.offset;
      const amount = Math.min(available, samplesToDrop - dropped);
      this.offset += amount;
      this.queuedSamples -= amount;
      dropped += amount;

      if (this.offset === this.frames[0].length) {
        this.frames.shift();
        this.offset = 0;
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    output.fill(0);

    if (!this.started) {
      if (this.queuedSamples < this.initialBufferSamples) return true;
      this.started = true;
    }

    let writeOffset = 0;
    while (writeOffset < output.length && this.frames.length) {
      const frame = this.frames[0];
      const available = frame.length - this.offset;
      const amount = Math.min(available, output.length - writeOffset);
      output.set(frame.subarray(this.offset, this.offset + amount), writeOffset);
      this.offset += amount;
      this.queuedSamples -= amount;
      writeOffset += amount;

      if (this.offset === frame.length) {
        this.frames.shift();
        this.offset = 0;
      }
    }

    if (writeOffset < output.length) this.started = false;
    return true;
  }
}

registerProcessor('sam-audio-processor', SamAudioProcessor);
