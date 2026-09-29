# Third-party components in the KWS wasm artifacts

`sherpa-onnx-wasm-kws-main.wasm` (and its `.js` glue and `.data` model image) is a single compiled
artifact: the sherpa-onnx keyword spotter plus every library CMake linked into it. Those libraries
are not separate files here, so this is where they are listed.

Each entry below records only what was read from the licence file actually present in the build tree
(`build-wasm-simd-kws/_deps/<name>-src/`) of the build that produced the committed binaries —
sherpa-onnx `v1.13.8`, emsdk `4.0.23`. No licence is inferred from a package name or a homepage.

| Component | Licence, as stated in the build tree |
| --- | --- |
| sherpa-onnx | Apache-2.0 — full text shipped next to this file as `LICENSE.sherpa-onnx` |
| onnxruntime | MIT per its upstream repository — licence text not present in the build tree, not verified here (`onnxruntime-src/` holds only `include/` and `lib/libonnxruntime.a`) |
| Eigen | MPL-2.0 (`COPYING.README`: "Eigen is primarily MPL2 licensed"; some files carry BSD or other MPL2-compatible licences, whose texts are in the sibling `COPYING.*` files) |
| fastcluster / hclust-cpp | BSD 2-clause (© 2011 Daniel Müllner, © 2018 Christoph Dalitz) |
| nlohmann/json | MIT (`LICENSE.MIT`, © 2013-2025 Niels Lohmann) |
| kaldi-decoder | Apache-2.0 |
| kaldifst | Apache-2.0, with a legal notice that copyright stays with the individual authors |
| kaldi-native-fbank | Apache-2.0 |
| KissFFT | BSD-3-Clause (`COPYING`: `SPDX-License-Identifier: BSD-3-Clause`) |
| OpenFst | Apache-2.0 |
| simple-sentencepiece | Apache-2.0 |

The wake-word model packed into `sherpa-onnx-wasm-kws-main.data`
(`sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`, int8) is distributed by the sherpa-onnx
project under Apache-2.0.

`tools/kws-wasm/README.md` documents how the artifacts are produced and how to rebuild them.
