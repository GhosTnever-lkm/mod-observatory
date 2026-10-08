import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const git = (...args) => execFileAsync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });

await execFileAsync(process.execPath, ['scripts/check-version.mjs'], { cwd: root });
const version = (await readFile(join(root, 'VERSION'), 'utf8')).trim();
const { stdout } = await git('ls-files', '-z');
const tracked = stdout.split('\0').filter(Boolean).filter((path) => !path.startsWith('fixtures/'));
if (!tracked.includes('index.html') || !tracked.includes('app.js') || !tracked.includes('core/graph.mjs')) {
  throw new Error('The tracked app entry points are missing; commit the project before packaging.');
}

const outDir = join(root, 'release');
await mkdir(outDir, { recursive: true });
const archive = join(outDir, `mod-observatory-${version}.zip`);
await rm(archive, { force: true });
await git('archive', '--format=zip', `--output=${archive}`, 'HEAD', ...tracked);
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(join(outDir, 'SHA256SUMS.txt'), `${digest}  ${relative(root, archive).split(sep).at(-1)}\n`, 'utf8');
console.log(`Created ${archive}`);
console.log(`SHA-256 ${digest}`);
