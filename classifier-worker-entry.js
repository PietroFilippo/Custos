// Runs the NSFW model inside a dedicated worker so inference never blocks the
// background page event loop (which also services the X response filters).
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { load } from 'nsfwjs/core';
import verdictConfig from './x-verdict.js';

let modelPromise;
let backendUsed = 'unknown';

// GPU first. Without WebGL (blocklisted drivers, hardware acceleration off,
// some virtual machines) WebAssembly classifies an image in about 70 ms where
// plain JavaScript takes over a second. setBackend reports failure by
// resolving false rather than throwing, so every step checks its result.
async function useBackend(name) {
  if (!(await tf.setBackend(name))) throw new Error(name + ' backend unavailable');
  await tf.ready();
  backendUsed = name;
}

async function pickBackend() {
  tf.enableProdMode();
  try {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas unavailable');
    await useBackend('webgl');
    return;
  } catch {}
  try {
    if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly unavailable');
    // The binaries ship next to this worker; nothing is fetched remotely.
    setWasmPaths(new URL('wasm/', self.location.href).href);
    await useBackend('wasm');
    return;
  } catch {}
  await useBackend('cpu');
}

function getModel(modelUrl) {
  if (!modelPromise) {
    modelPromise = (async () => {
      await pickBackend();
      const model = await load(modelUrl, { type: 'graph', size: verdictConfig.MODEL_INPUT_SIZE });
      // Warm-up inference pays shader compilation / kernel setup before the
      // first real image arrives.
      const size = verdictConfig.MODEL_INPUT_SIZE;
      await model.classify(new ImageData(size, size), 5);
      return model;
    })().catch(error => {
      modelPromise = undefined;
      throw error;
    });
  }
  return modelPromise;
}

self.onmessage = async event => {
  const message = event.data;
  if (message?.type === 'init') {
    getModel(message.modelUrl).catch(() => {});
    return;
  }
  if (message?.type !== 'classify') return;
  try {
    const model = await getModel(message.modelUrl);
    const pixels = new Uint8ClampedArray(message.pixels);
    const imageData = new ImageData(pixels, message.width, message.height);
    const predictions = await model.classify(imageData, 5);
    const preset = verdictConfig.presetValues(message.sensitivity);
    const decision = verdictConfig.decidePredictions(predictions, preset.threshold, preset.sexyWeight, preset.hentaiSolo);
    self.postMessage({ type: 'result', id: message.id, ok: true, decision, backend: backendUsed });
  } catch (error) {
    self.postMessage({ type: 'result', id: message.id, ok: false, error: error?.message || 'classification failed' });
  }
};
