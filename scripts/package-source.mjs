// Source archive for Mozilla's add-on review. The bundled classifier is built
// by esbuild, so reviewers need the exact sources, lockfile, and build steps
// (see README.md, "Building from source"). The archive is the committed tree.
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
if (dirty) throw new Error('Commit or stash changes first; the source archive is built from the committed tree.\n' + dirty);
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const output = path.join('artifacts', `custos-${version}-source.zip`);
execFileSync('git', ['archive', '--format=zip', '--prefix=custos-' + version + '/', '-o', output, 'HEAD'], { cwd: root, stdio: 'inherit' });
console.log('Source archive: ' + output);
