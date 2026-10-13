import type { KwsEngine, WakeOptions } from './types.ts';
import { WorkletAudioCapture, type AudioCapture } from './audio-capture.ts';
import { buildKeywordsConfig } from './keyword-tokens.ts';

export type { AudioCapture } from './audio-capture.ts';

export interface KwsWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: { message?: string }) => void) | null;
}

export interface SherpaKwsDeps {
  createWorker(url: string): KwsWorkerLike;
  createCapture(workletUrl: string): AudioCapture;
  now(): number;
  loadTimeoutMs: number;
}

type WorkerMessage = { type: 'ready' } | { type: 'inited' } | { type: 'keyword'; keyword: string } | { type: 'fatal'; message: string };

const DEFAULTS = { threshold: 0.25, score: 1.0, cooldownMs: 1500, loadTimeoutMs: 30000 } as const;
const DISPOSED_MESSAGE = 'KWS engine was disposed while loading';

// The DOM Worker's handler properties are typed against MessageEvent/ErrorEvent, so it is not structurally a
// KwsWorkerLike; adapt it instead of widening the interface to DOM types (keeps fakes trivial).
function browserWorker(url: string): KwsWorkerLike {
  const worker = new Worker(url);
  const like: KwsWorkerLike = {
    postMessage: (message, transfer) => worker.postMessage(message, transfer ?? []),
    terminate: () => worker.terminate(),
    onmessage: null,
    onerror: null,
  };
  worker.onmessage = (ev: MessageEvent<unknown>) => like.onmessage?.({ data: ev.data });
  worker.onerror = (ev: ErrorEvent) => like.onerror?.({ message: ev.message });
  return like;
}

function isWorkerMessage(data: unknown): data is WorkerMessage {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string';
}

/** Local wake-word detection: sherpa-onnx KWS in a Web Worker, fed by an AudioWorklet. Audio never leaves the page. */
export class SherpaKwsEngine implements KwsEngine {
  private readonly deps: SherpaKwsDeps;
  private readonly handlers = new Set<(keyword: string) => void>();
  private readonly errorHandlers = new Set<(message: string) => void>();
  private worker: KwsWorkerLike | null = null;
  private capture: AudioCapture | null = null;
  private listening = false;
  private broken = false;
  private disposed = false;
  /** Set by handshake() while a load() is waiting on the worker; lets dispose() settle it immediately. */
  private cancelLoad: ((reason: Error) => void) | null = null;
  private lastHitAt = Number.NEGATIVE_INFINITY;
  /** The capture operation in flight, and the one desired state waiting for it — see setCaptureRunning(). */
  private captureOp: Promise<void> | null = null;
  private pendingCapture: (() => Promise<void>) | null = null;

  constructor(private readonly options: WakeOptions, deps: Partial<SherpaKwsDeps> = {}) {
    this.deps = {
      createWorker: browserWorker,
      createCapture: (url) => new WorkletAudioCapture(url),
      now: () => performance.now(),
      loadTimeoutMs: DEFAULTS.loadTimeoutMs,
      ...deps,
      // The option is the integrator's, so it outranks the default this class ships with.
      ...(options.loadTimeoutMs === undefined ? {} : { loadTimeoutMs: options.loadTimeoutMs }),
    };
  }

  onKeyword(handler: (keyword: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onError(handler: (message: string) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  async load(mic: MediaStream): Promise<void> {
    const keywords = buildKeywordsConfig(this.options.keywords); // fail on bad config before fetching 12 MB of wasm
    // A keyword whose tokens are wrong is invisible — it simply never fires — so say out loud what
    // the spotter is being given. Once per load, and the only thing this module ever prints.
    console.info(`[dsh-voice-hub] 本地唤醒词模型音节：\n${keywords}`);
    const base = this.options.assetsPath.endsWith('/') ? this.options.assetsPath : `${this.options.assetsPath}/`;
    this.disposed = false;
    this.broken = false; // a stale `fatal` from a previous load on this instance must not silence the new one
    this.lastHitAt = Number.NEGATIVE_INFINITY;
    this.captureOp = null; // nothing queued against the previous capture may delay this one
    this.pendingCapture = null;
    try {
      const worker = this.deps.createWorker(`${base}kws-worker.js`);
      this.worker = worker;
      await this.handshake(worker, keywords); // rejects immediately with DISPOSED_MESSAGE if dispose() cancels it
      this.assertNotDisposed(); // dispose() may have landed in the microtask gap right after the handshake resolved
      const capture = this.deps.createCapture(`${base}kws-capture-worklet.js`);
      this.capture = capture;
      await capture.start(mic, (sampleRate, samples) => {
        if (this.listening && this.worker) this.worker.postMessage({ type: 'audio', sampleRate, samples }, [samples.buffer]);
      });
      this.assertNotDisposed(); // dispose() closed `capture` already; just fail the promise
      await capture.suspend();
      this.assertNotDisposed();
    } catch (e) {
      this.dispose();
      throw e;
    }
  }

  resume(): void {
    if (!this.worker || !this.capture) return;
    this.listening = true;
    this.setCaptureRunning(this.capture, true);
  }

  pause(): void {
    if (!this.worker || !this.capture) return;
    this.listening = false;
    this.worker.postMessage({ type: 'reset' });
    this.setCaptureRunning(this.capture, false);
  }

  dispose(): void {
    this.disposed = true;
    this.listening = false;
    this.pendingCapture = null; // whatever was queued is moot: this capture is being closed
    const cancelLoad = this.cancelLoad;
    this.cancelLoad = null;
    const { worker, capture } = this;
    this.worker = null;
    this.capture = null;
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
    if (capture) void this.quietly(capture.close());
    cancelLoad?.(new Error(DISPOSED_MESSAGE)); // wakes up a load() that is still waiting on the worker
  }

  /**
   * Starts or stops the flow of microphone blocks, one operation at a time.
   *
   * AudioContext.suspend()/resume() settle asynchronously, so a resume() issued while a suspend() is
   * still in flight used to see a context that still read 'running', skip its own work, and then have
   * the pending suspend land on top of it: the spotter went deaf on a suspended context while the SDK
   * believed it was listening, until the next full session. (A 429 BUSY or a LAN token error fails an
   * activation in milliseconds, which is all it takes.) Each request therefore waits for the previous
   * one to settle, and only the most recent one survives that wait.
   */
  private setCaptureRunning(capture: AudioCapture, running: boolean): void {
    const op = (): Promise<void> => this.quietly(running ? capture.resume() : capture.suspend());
    if (this.captureOp) {
      this.pendingCapture = op;
      return;
    }
    this.runCaptureOp(op);
  }

  private runCaptureOp(op: () => Promise<void>): void {
    this.captureOp = op().then(() => {
      this.captureOp = null;
      const next = this.pendingCapture;
      this.pendingCapture = null;
      if (next) this.runCaptureOp(next);
    });
  }

  /** Browsers can reject resume()/suspend()/close() under state races; none of that is news here. */
  private quietly(p: Promise<void>): Promise<void> {
    return p.catch(() => undefined);
  }

  /** Every await in load() is followed by this: a concurrent dispose() must fail the promise it interrupted. */
  private assertNotDisposed(): void {
    if (this.disposed) throw new Error(DISPOSED_MESSAGE);
  }

  private handshake(worker: KwsWorkerLike, keywords: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const settle = (done: () => void): void => {
        clearTimeout(timer);
        this.cancelLoad = null;
        done();
      };
      const timer = setTimeout(() => settle(() => reject(new Error(`KWS worker timed out after ${this.deps.loadTimeoutMs} ms`))), this.deps.loadTimeoutMs);
      this.cancelLoad = (reason) => settle(() => reject(reason));
      worker.onerror = (ev) => settle(() => reject(new Error(`KWS worker failed to load: ${ev.message ?? 'unknown error'}`)));
      worker.onmessage = (ev) => {
        if (!isWorkerMessage(ev.data)) return;
        const message = ev.data;
        if (message.type === 'ready') {
          worker.postMessage({
            type: 'init', keywords,
            threshold: this.options.threshold ?? DEFAULTS.threshold,
            score: this.options.score ?? DEFAULTS.score,
          });
        } else if (message.type === 'inited') {
          worker.onmessage = (later) => this.onWorkerMessage(later.data);
          worker.onerror = (later) => this.markBroken(`KWS worker failed: ${later.message ?? 'unknown error'}`);
          settle(resolve);
        } else if (message.type === 'fatal') {
          settle(() => reject(new Error(`KWS worker: ${message.message}`)));
        }
      };
    });
  }

  /**
   * The spotter is dead, and it happened after load() had already resolved — so there is no promise
   * left to reject. It never wakes the assistant again; whoever is listening gets told once.
   */
  private markBroken(message: string): void {
    if (this.broken) return;
    this.broken = true;
    for (const handler of [...this.errorHandlers]) handler(message);
  }

  private onWorkerMessage(data: unknown): void {
    if (!isWorkerMessage(data)) return;
    if (data.type === 'fatal') { this.markBroken(`KWS worker: ${data.message}`); return; }
    if (data.type !== 'keyword' || !this.listening || this.broken) return;
    const now = this.deps.now();
    if (now - this.lastHitAt < (this.options.cooldownMs ?? DEFAULTS.cooldownMs)) return;
    this.lastHitAt = now;
    for (const handler of [...this.handlers]) handler(data.keyword);
  }
}
