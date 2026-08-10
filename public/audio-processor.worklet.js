// AudioWorklet Processor for ultra-low latency PCM capture & resampling
class MoshiAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    const processorOptions = options.processorOptions || {};
    this.targetSampleRate = processorOptions.targetSampleRate || 24000;
    this.format = processorOptions.format || 'int16'; // 'int16' or 'float32'
    this.frameSizeMs = processorOptions.frameSizeMs || 20; // 20ms chunk size
    
    // Sample rate will be set dynamically based on sampleRate global in Worklet
    this.sourceSampleRate = sampleRate;
    
    // Calculate required output samples per frame
    this.outputFrameSamples = Math.round((this.targetSampleRate * this.frameSizeMs) / 1000);
    
    // Buffer for resampling accumulator
    this.inputBuffer = [];
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'SET_TARGET_SAMPLE_RATE') {
        this.targetSampleRate = event.data.targetSampleRate || 24000;
        this.outputFrameSamples = Math.round((this.targetSampleRate * this.frameSizeMs) / 1000);
      } else if (event.data.type === 'SET_FORMAT') {
        this.format = event.data.format || 'int16';
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0]; // Mono input
    
    // Accumulate input samples
    for (let i = 0; i < channelData.length; i++) {
      this.inputBuffer.push(channelData[i]);
    }

    // Downsample / Resample ratio
    const ratio = this.sourceSampleRate / this.targetSampleRate;
    const requiredInputSamples = Math.floor(this.outputFrameSamples * ratio);

    while (this.inputBuffer.length >= requiredInputSamples) {
      const outputBuffer = new Float32Array(this.outputFrameSamples);

      // Linear interpolation resampling
      for (let i = 0; i < this.outputFrameSamples; i++) {
        const srcPos = i * ratio;
        const index0 = Math.floor(srcPos);
        const index1 = Math.min(index0 + 1, this.inputBuffer.length - 1);
        const weight = srcPos - index0;

        const val0 = this.inputBuffer[index0] || 0;
        const val1 = this.inputBuffer[index1] || 0;
        
        outputBuffer[i] = val0 * (1 - weight) + val1 * weight;
      }

      // Remove consumed samples from inputBuffer
      this.inputBuffer.splice(0, requiredInputSamples);

      // Format conversion
      if (this.format === 'int16') {
        const int16Buffer = new Int16Array(this.outputFrameSamples);
        for (let i = 0; i < this.outputFrameSamples; i++) {
          const s = Math.max(-1, Math.min(1, outputBuffer[i]));
          int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage({
          type: 'AUDIO_CHUNK',
          buffer: int16Buffer.buffer
        }, [int16Buffer.buffer]);
      } else {
        this.port.postMessage({
          type: 'AUDIO_CHUNK',
          buffer: outputBuffer.buffer
        }, [outputBuffer.buffer]);
      }
    }

    return true;
  }
}

registerProcessor('moshi-audio-processor', MoshiAudioProcessor);
