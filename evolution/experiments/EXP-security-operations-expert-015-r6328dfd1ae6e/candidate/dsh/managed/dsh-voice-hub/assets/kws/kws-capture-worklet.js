/* AudioWorklet: batches microphone audio into ~100 ms Float32 blocks and posts them to the main thread.
 * Plain JS on purpose (loaded by URL with audioWorklet.addModule). */
class TalkKwsCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    // Fixed once: after a block is TRANSFERRED its array is detached and reports length 0, so the size of the
    // next block must never be read from the old one (that made a zero-length block and an endless post loop).
    this.size = Math.round(sampleRate / 10);
    this.block = new Float32Array(this.size);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const n = Math.min(channel.length - offset, this.block.length - this.filled);
      this.block.set(channel.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === this.block.length) {
        const full = this.block;
        this.port.postMessage({ sampleRate, samples: full }, [full.buffer]);
        this.block = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('talk-kws-capture', TalkKwsCapture);
