import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { MobileNetV2MidModel } from 'nsfwjs/models/mobilenet_v2_mid';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const staticFiles = [
  'background.js', 'adult-sites.js',
  'blocked.css', 'blocked.html', 'blocked.js',
  'catholic-quotes.js',
  'common.js', 'theme.css',
  'manifest.json',
  'options.css', 'options.html', 'options.js',
  'THIRD_PARTY_NOTICES.md', 'LICENSE',
  'popup.css', 'popup.html', 'popup.js',
  'x-media-utils.js', 'x-metadata.js', 'x-protection-v2.js', 'x-protection-v3.css', 'x-verdict.js',
  'x-user-controls.js', 'x-interactions.js', 'x-profile-protection.js',
];
async function writeModelAssets() {
  const modelDir = path.join(dist, 'models', 'mobilenet_v2_mid');
  await mkdir(modelDir, { recursive: true });
  const modelJson = (await MobileNetV2MidModel.modelJson()).default;
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify(modelJson));
  const paths = modelJson.weightsManifest.flatMap(group => group.paths);
  for (let index = 0; index < MobileNetV2MidModel.weightBundles.length; index += 1) {
    const base64 = (await MobileNetV2MidModel.weightBundles[index]()).default;
    await writeFile(path.join(modelDir, paths[index]), Buffer.from(base64, 'base64'));
  }
}


await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await Promise.all(staticFiles.map(file => cp(path.join(root, file), path.join(dist, file))));
await cp(path.join(root, 'data'), path.join(dist, 'data'), { recursive: true });
await cp(path.join(root, 'icons'), path.join(dist, 'icons'), { recursive: true });
// Full license texts of the bundled dependencies (the bundle strips comments).
await cp(path.join(root, 'licenses'), path.join(dist, 'licenses'), { recursive: true });
await cp(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });
// WebAssembly fallback for the classifier when WebGL is unavailable. The
// threaded build needs cross-origin isolation, which extension workers lack,
// so only the plain and SIMD binaries ship.
const wasmFiles = ['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm'];
await mkdir(path.join(dist, 'wasm'), { recursive: true });
for (const file of wasmFiles) {
  await cp(path.join(root, 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist', file), path.join(dist, 'wasm', file));
}

// The replacement-art list is generated from whatever is in assets/sacred-art
// so adding or removing paintings never requires a code change. Each entry
// carries the painting's aspect ratio so the coordinator can pick artwork
// that fits the censored cell's shape instead of leaving huge backdrop bars.
function jpegDimensions(buffer) {
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xFF) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xFF) { offset += 1; continue; }
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xC0 && marker <= 0xCF &&
      marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isStartOfFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function pngDimensions(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504E47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function artAspect(file) {
  try {
    const buffer = await readFile(path.join(root, 'assets', 'sacred-art', file));
    const size = /\.png$/i.test(file) ? pngDimensions(buffer) : jpegDimensions(buffer);
    if (!size?.width || !size?.height) return null;
    return Math.round((size.width / size.height) * 1000) / 1000;
  } catch {
    return null;
  }
}

const artFiles = (await readdir(path.join(root, 'assets', 'sacred-art')))
  .filter(file => /\.(?:jpe?g|png|webp)$/i.test(file))
  .sort();
// Every painting must be credited: the viewer shows its title, artist, and
// museum, and the notices point to these public-domain sources.
const credits = new Map(JSON.parse(await readFile(path.join(root, 'assets', 'sacred-art', 'CREDITS.json'), 'utf8'))
  .map(entry => [entry.file, entry]));
const uncredited = artFiles.filter(file => !credits.has(file));
if (uncredited.length) throw new Error('Paintings without credits in CREDITS.json: ' + uncredited.join(', '));
const artEntries = await Promise.all(artFiles.map(async file => {
  const { title, artist, date, museum, url } = credits.get(file);
  return { file, aspect: await artAspect(file), title, artist, date, museum, url };
}));

// The source paintings are stored at high JPEG quality. The packaged copies
// are re-encoded once (cached by content hash) at a quality that looks the
// same at their display size, roughly halving the extension's download.
const ART_QUALITY = 82;
const artCache = path.join(root, 'node_modules', '.cache', 'custos-art');
await mkdir(artCache, { recursive: true });
let artBytesBefore = 0;
let artBytesAfter = 0;
for (const file of artFiles.filter(name => /\.jpe?g$/i.test(name))) {
  const source = await readFile(path.join(root, 'assets', 'sacred-art', file));
  const cached = path.join(artCache, createHash('sha256').update(source).digest('hex').slice(0, 32) + '-q' + ART_QUALITY + '.jpg');
  let output;
  try {
    output = await readFile(cached);
  } catch {
    const encoded = Buffer.from(jpeg.encode(jpeg.decode(source, { useTArray: true, maxMemoryUsageInMB: 1024 }), ART_QUALITY).data);
    output = encoded.length < source.length ? encoded : source;
    await writeFile(cached, output);
  }
  artBytesBefore += source.length;
  artBytesAfter += output.length;
  await writeFile(path.join(dist, 'assets', 'sacred-art', file), output);
}
console.log(`Paintings: ${(artBytesBefore / 1048576).toFixed(1)} MB -> ${(artBytesAfter / 1048576).toFixed(1)} MB in the package`);
await writeFile(path.join(dist, 'sacred-art-list.js'), 'globalThis.TabCloserSacredArt = ' + JSON.stringify(artEntries) + ';\n');

await writeModelAssets();
const bundleOptions = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['firefox140'],
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
};
await build({
  ...bundleOptions,
  entryPoints: [path.join(root, 'classifier-entry.js')],
  outfile: path.join(dist, 'classifier-runtime.js'),
});
await build({
  ...bundleOptions,
  entryPoints: [path.join(root, 'classifier-worker-entry.js')],
  outfile: path.join(dist, 'classifier-worker.js'),
});

const manifestPath = path.join(dist, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
// The repo root doubles as the dev-loadable extension; it needs every
// generated runtime asset too.
await cp(path.join(dist, 'classifier-runtime.js'), path.join(root, 'classifier-runtime.js'));
await cp(path.join(dist, 'classifier-worker.js'), path.join(root, 'classifier-worker.js'));
await cp(path.join(dist, 'sacred-art-list.js'), path.join(root, 'sacred-art-list.js'));
await cp(path.join(dist, 'models'), path.join(root, 'models'), { recursive: true });
await cp(path.join(dist, 'wasm'), path.join(root, 'wasm'), { recursive: true });
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Built extension in ' + dist);
