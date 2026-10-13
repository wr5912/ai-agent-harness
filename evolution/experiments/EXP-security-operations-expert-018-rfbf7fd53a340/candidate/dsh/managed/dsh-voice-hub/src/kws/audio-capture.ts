export interface AudioCapture {
  start(mic: MediaStream, onChunk: (sampleRate: number, samples: Float32Array) => void): Promise<void>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

const PROCESSOR = 'talk-kws-capture';

/** Microphone -> ~100 ms Float32 blocks, via the kws-capture-worklet.js asset. Browser only. */
export class WorkletAudioCapture implements AudioCapture {
  private context: AudioContext | null = null;
  // The graph MUST be referenced from JS: Chrome garbage-collects a MediaStreamAudioSourceNode (and the worklet
  // node behind it) that nothing points to, and capture then goes silent after the first GC — found by the
  // end-to-end test, where wake-word detection died after one 60 s conversation.
  private graph: { source: MediaStreamAudioSourceNode; node: AudioWorkletNode; mute: GainNode } | null = null;

  constructor(private readonly workletUrl: string) {}

  async start(mic: MediaStream, onChunk: (sampleRate: number, samples: Float32Array) => void): Promise<void> {
    const context = new AudioContext();
    this.context = context;
    await context.audioWorklet.addModule(this.workletUrl);
    const node = new AudioWorkletNode(context, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    node.port.onmessage = (ev: MessageEvent<{ sampleRate: number; samples: Float32Array }>) => onChunk(ev.data.sampleRate, ev.data.samples);
    const source = context.createMediaStreamSource(mic);
    // A node nobody pulls from may never be processed; route it to the output through a muted gain.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);
    this.graph = { source, node, mute };
  }

  // Both call through unconditionally. `state` lags: it stays 'running' until a pending suspend()
  // settles, so gating on it made a resume() issued right after a suspend() do nothing at all and
  // leave the capture stopped. Browsers make both idempotent, so the redundant calls cost nothing.
  async suspend(): Promise<void> {
    if (this.context) await this.context.suspend();
  }

  async resume(): Promise<void> {
    if (this.context) await this.context.resume();
  }

  async close(): Promise<void> {
    const { context, graph } = this;
    this.context = null;
    this.graph = null;
    if (graph) {
      graph.node.port.onmessage = null;
      graph.source.disconnect();
      graph.node.disconnect();
      graph.mute.disconnect();
    }
    if (context && context.state !== 'closed') await context.close();
  }
}
