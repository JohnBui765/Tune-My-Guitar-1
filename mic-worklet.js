// Echo Tune: the microphone listener. It runs on the iPhone's audio thread, collects the
// microphone's samples without missing a single one, and hands them to the app in blocks
// of about 20 ms. All the measuring happens in pitch.js, on the app's own thread.
class EchoTuneMic extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = (options && options.processorOptions && options.processorOptions.block) || 1024;
    this.buf = new Float32Array(this.size);
    this.fill = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];   // the microphone is mono; take the first channel
    if (channel) {
      let i = 0;
      while (i < channel.length) {
        const n = Math.min(channel.length - i, this.size - this.fill);
        this.buf.set(channel.subarray(i, i + n), this.fill);
        this.fill += n;
        i += n;
        if (this.fill === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);   // hand the block over without copying it
          this.buf = new Float32Array(this.size);
          this.fill = 0;
        }
      }
    }
    return true;   // keep listening
  }
}

registerProcessor('echo-tune-mic', EchoTuneMic);
