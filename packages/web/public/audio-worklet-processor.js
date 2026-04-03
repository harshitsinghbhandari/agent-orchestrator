/* global AudioWorkletProcessor, registerProcessor */
/**
 * PCM Audio Worklet Processor
 *
 * Converts floating-point audio samples from the microphone to 16-bit PCM
 * for transmission to the Gemini Live API.
 *
 * This replaces the deprecated ScriptProcessorNode for better performance
 * and to avoid main thread blocking.
 */

class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      const samples = input[0];
      const pcm = new Int16Array(samples.length);

      // Convert float32 samples (-1.0 to 1.0) to int16 (-32768 to 32767)
      for (let i = 0; i < samples.length; i++) {
        // Clamp to [-1, 1] range
        const s = Math.max(-1, Math.min(1, samples[i]));
        // Convert to int16
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Transfer the buffer to the main thread
      this.port.postMessage({ pcm: pcm.buffer }, [pcm.buffer]);
    }

    // Return true to keep the processor alive
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
