import { readFile } from 'node:fs/promises';

const version = (await readFile(new URL('../VERSION', import.meta.url), 'utf8')).trim();
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

const checks = [
  ['package.json', packageJson.version === version],
  ['index.html', html.includes(`id="version">${version}</span> · Локальный аудит модпаков`) && html.includes(`ЛОКАЛЬНЫЙ СЕАНС · v${version}`)],
  ['app.js', app.includes(`$('version').textContent = '${version}'`)],
  ['CHANGELOG.md', changelog.includes(`## ${version} —`)],
];
const failed = checks.filter(([, passed]) => !passed);
for (const [file, passed] of checks) console.log(`${passed ? 'OK' : 'FAIL'} ${file}: ${version}`);
if (failed.length) process.exitCode = 1;
