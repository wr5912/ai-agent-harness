/* Classic Web Worker hosting the sherpa-onnx keyword spotter.
 * Plain JS on purpose: the host page loads it by URL next to the wasm, so it must not go through a bundler.
 * Protocol — in:  {type:'init', keywords, threshold, score} | {type:'audio', sampleRate, samples} | {type:'reset'}
 *            out: {type:'ready'} | {type:'inited'} | {type:'keyword', keyword} | {type:'fatal', message}
 * unhandledrejection/error listeners: the glue preloads sherpa-onnx-wasm-kws-main.data through an async
 * function invoked fire-and-forget (no .then/.catch attached), so a failed fetch (404, network error) rejects
 * with nothing to catch it — onAbort alone only covers the wasm-binary path, not this one — and without these
 * listeners the worker would emit neither 'ready' nor 'fatal' and just go silent. */
'use strict';

var spotter = null;
var stream = null;

function fatal(e) {
  self.postMessage({ type: 'fatal', message: String(e && e.message ? e.message : e) });
}

self.addEventListener('unhandledrejection', function (ev) { fatal(ev.reason); });
self.addEventListener('error', function (ev) { fatal(ev.message || ev.error || 'worker error'); });

// The emscripten glue is a plain script that reads a global Module.
self.Module = {
  onRuntimeInitialized: function () { self.postMessage({ type: 'ready' }); },
  onAbort: fatal,
};

try {
  importScripts('sherpa-onnx-kws.js', 'sherpa-onnx-wasm-kws-main.js');
} catch (e) {
  fatal(e);
}

// createKws REPLACES its defaults when given a config, so every field must be present.
function spotterConfig(m) {
  var stem = '-epoch-12-avg-2-chunk-16-left-64.onnx';
  return {
    featConfig: { samplingRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: './encoder' + stem, decoder: './decoder' + stem, joiner: './joiner' + stem },
      tokens: './tokens.txt', provider: 'cpu', modelType: '', numThreads: 1, debug: 0,
      modelingUnit: 'cjkchar', bpeVocab: '',
    },
    maxActivePaths: 4, numTrailingBlanks: 1,
    keywordsScore: m.score, keywordsThreshold: m.threshold, keywords: m.keywords,
  };
}

self.onmessage = function (ev) {
  var m = ev.data;
  try {
    if (m.type === 'init') {
      if (stream) { stream.free(); stream = null; }
      if (spotter) { spotter.free(); spotter = null; }
      spotter = createKws(self.Module, spotterConfig(m));
      stream = spotter.createStream();
      self.postMessage({ type: 'inited' });
    } else if (m.type === 'audio') {
      if (!stream) return;
      stream.acceptWaveform(m.sampleRate, m.samples);
      while (spotter.isReady(stream)) {
        spotter.decode(stream);
        var r = spotter.getResult(stream);
        if (r.keyword) {
          self.postMessage({ type: 'keyword', keyword: r.keyword });
          // A hit only has to clear the decoder's matched path so the same wake word can be spotted
          // again; spotter.reset() does exactly that and keeps the stream's feature history, which
          // is what lets detection continue mid-audio. The 'reset' message below is a different
          // job — see there.
          spotter.reset(stream);
        }
      }
    } else if (m.type === 'reset') {
      // drop whatever was half-heard before a pause, so it cannot complete a match after resume.
      // That needs the feature history GONE, not just the decoder's path cleared, so this frees the
      // stream and makes a new one instead of using the light spotter.reset() above.
      if (spotter && stream) { stream.free(); stream = spotter.createStream(); }
    }
  } catch (e) {
    fatal(e);
  }
};
