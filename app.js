import { analyzeCollection, compareCollections, normalizeRelativePath } from './core/graph.mjs';

const $ = (id) => document.getElementById(id);
const state = { mods: [], analysis: null, previous: null, theme: 'dark' };
const ui = {
  folder: $('folder-input'), zip: $('zip-input'), snapshot: $('snapshot-input'), status: $('status'), list: $('collection-list'),
  findings: $('finding-list'), paths: $('path-list'), graph: $('graph-view'), compare: $('compare-panel'), compareResults: $('compare-results'),
};

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function showStatus(message, kind = 'info') {
  ui.status.hidden = false;
  ui.status.className = 'status-message';
  ui.status.dataset.kind = kind === 'info' ? 'notice' : kind;
  ui.status.textContent = message;
}

function hideStatus() { ui.status.hidden = true; }

function getText(content) {
  return new TextDecoder('utf-8', { fatal: false }).decode(content);
}

function parseDescriptor(text, fallbackName, id) {
  const field = (name) => {
    const match = text.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'is'));
    return match?.[2]?.trim() || null;
  };
  const name = field('name') || fallbackName;
  const dependencies = [];
  for (const block of text.matchAll(/\{([^{}]*)\}/g)) {
    const depName = block[1].match(/\bname\s*=\s*(["'])(.*?)\1/is)?.[2]?.trim();
    if (depName) dependencies.push({ id: depName, name: depName });
  }
  const replacePaths = [...text.matchAll(/\bpath\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]);
  return { id, name, game: 'Paradox / Clausewitz', dependencies, declaredPaths: replacePaths };
}

function stableId(label, index) {
  return `mod-${index + 1}-${label.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'package'}`;
}

function modNameFromPath(path) {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  const descriptor = parts.findIndex((part) => part.toLowerCase() === 'descriptor.mod');
  if (descriptor > 0) return parts[descriptor - 1];
  const last = parts.at(-1) || 'Mod';
  return last.replace(/\.zip$/i, '').replace(/\.mod$/i, '') || 'Mod';
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

function findEOCD(view) {
  const min = Math.max(0, view.byteLength - 65557);
  for (let p = view.byteLength - 22; p >= min; p--) if (view.getUint32(p, true) === 0x06054b50) return p;
  return -1;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of new Uint8Array(bytes)) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes, expectedSize) {
  if (typeof DecompressionStream === 'undefined') throw new Error('этот браузер не поддерживает распаковку ZIP/deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > expectedSize || total > 512 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('распакованный размер файла не совпадает с безопасным лимитом каталога');
    }
    chunks.push(value);
  }
  if (total !== expectedSize) throw new Error('распакованный размер файла не совпал с каталогом ZIP');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output.buffer;
}

async function readZip(file) {
  const bytes = await file.arrayBuffer();
  const view = new DataView(bytes);
  const eocd = findEOCD(view);
  if (eocd < 0) throw new Error('не найден конец ZIP-каталога');
  const entries = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || centralOffset === 0xffffffff) throw new Error('ZIP64 пока не поддерживается');
  const files = [];
  let totalExpanded = 0;
  let p = centralOffset;
  for (let i = 0; i < entries; i++) {
    if (p + 46 > view.byteLength || view.getUint32(p, true) !== 0x02014b50) throw new Error('повреждён ZIP-каталог');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const expectedCRC = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    if (flags & 1) throw new Error('зашифрованные ZIP-файлы не поддерживаются');
    const nameBytes = new Uint8Array(bytes, p + 46, nameLength);
    const name = new TextDecoder((flags & 0x800) ? 'utf-8' : 'windows-1252').decode(nameBytes);
    p += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const normalized = normalizeRelativePath(name);
    if (size > 512 * 1024 * 1024) throw new Error(`файл ${name} превышает лимит 512 МБ`);
    totalExpanded += size;
    if (totalExpanded > 512 * 1024 * 1024) throw new Error('суммарный размер содержимого ZIP превышает лимит 512 МБ');
    if (files.length >= 50000) throw new Error('в архиве больше 50 000 файлов');
    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.byteLength) throw new Error('архив обрезан');
    let content;
    if (method === 0) content = bytes.slice(dataOffset, dataOffset + compressedSize);
    else if (method === 8) content = await inflateRaw(bytes.slice(dataOffset, dataOffset + compressedSize), size);
    else throw new Error(`метод сжатия ${method} не поддерживается`);
    if (content.byteLength !== size) throw new Error(`размер файла ${name} не совпал с каталогом ZIP`);
    if (crc32(content) !== expectedCRC) throw new Error(`контрольная сумма файла ${name} не совпала`);
    files.push({ path: normalized?.display || name, size, hash: await sha256(content), text: name.toLowerCase().endsWith('.mod') || name.toLowerCase() === 'descriptor.mod' ? getText(content) : null });
  }
  return files;
}

function groupFolderFiles(fileList) {
  const groups = new Map();
  for (const file of fileList) {
    const relative = file.webkitRelativePath || file.name;
    const normalized = normalizeRelativePath(relative);
    if (!normalized) continue;
    const first = normalized.display.split('/')[0];
    if (!groups.has(first)) groups.set(first, []);
    groups.get(first).push({ file, path: normalized.display.split('/').slice(1).join('/') || file.name });
  }
  return groups;
}

async function importFolders(fileList) {
  if (fileList.length > 50000) throw new Error('выбрано больше 50 000 файлов');
  const totalSize = [...fileList].reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 512 * 1024 * 1024) throw new Error('суммарный размер выбранных папок превышает лимит 512 МБ');
  const groups = groupFolderFiles(fileList);
  for (const [folder, items] of groups) {
    const id = stableId(folder, state.mods.length);
    const descriptor = items.find((x) => x.path.toLowerCase() === 'descriptor.mod');
    const metadata = descriptor ? parseDescriptor(await descriptor.file.text(), folder, id) : { id, name: folder, game: 'Не определена', dependencies: [] };
    const files = [];
    for (const { file, path } of items) {
      if (!path) continue;
      files.push({ path, size: file.size, hash: await sha256(await file.arrayBuffer()) });
    }
    state.mods.push({ ...metadata, id, enabled: true, order: state.mods.length, files, loadAfter: [], conflictsWith: [] });
  }
}

async function importZips(fileList) {
  const combinedBytes = [...fileList].reduce((sum, file) => sum + file.size, 0);
  if (combinedBytes > 512 * 1024 * 1024) throw new Error('суммарный размер выбранных ZIP превышает лимит 512 МБ');
  let expandedTotal = 0;
  for (const file of fileList) {
    const paths = await readZip(file);
    expandedTotal += paths.reduce((sum, entry) => sum + entry.size, 0);
    if (expandedTotal > 512 * 1024 * 1024) throw new Error('суммарный распакованный размер выбранных ZIP превышает лимит 512 МБ');
    const descriptor = paths.find((f) => f.path.toLowerCase().endsWith('/descriptor.mod')) || paths.find((f) => f.path.toLowerCase() === 'descriptor.mod') || paths.find((f) => f.path.toLowerCase().endsWith('.mod'));
    const label = modNameFromPath(descriptor?.path || file.name);
    const id = stableId(label, state.mods.length);
    const metadata = descriptor?.text ? parseDescriptor(descriptor.text, label, id) : { id, name: label, game: 'Не определена', dependencies: [] };
    const descriptorRoot = descriptor?.path.toLowerCase().endsWith('/descriptor.mod') ? descriptor.path.slice(0, descriptor.path.lastIndexOf('/') + 1) : '';
    const packageFiles = paths.filter((entry) => entry !== descriptor);
    const sharedRoot = packageFiles.length && packageFiles.every((entry) => entry.path.includes('/'))
      ? packageFiles.map((entry) => entry.path.split('/')[0]).every((root, _, roots) => root === roots[0]) ? `${packageFiles[0].path.split('/')[0]}/` : ''
      : '';
    const stripRoot = descriptorRoot || sharedRoot;
    const files = packageFiles.map((entry) => ({ path: stripRoot && entry.path.startsWith(stripRoot) ? entry.path.slice(stripRoot.length) : entry.path, size: entry.size, hash: entry.hash }));
    state.mods.push({ ...metadata, id, enabled: true, order: state.mods.length, files, loadAfter: [], conflictsWith: [] });
  }
}

function updateAnalysis() {
  const byName = new Map();
  for (const mod of state.mods) {
    const key = String(mod.name || '').trim().toLocaleLowerCase('en-US');
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(mod);
  }
  for (const mod of state.mods) {
    mod.dependencies = (Array.isArray(mod.dependencies) ? mod.dependencies : []).map((dep) => {
      const matches = byName.get(String(dep.name || dep.id || '').trim().toLocaleLowerCase('en-US')) || [];
      return matches.length === 1 ? { ...dep, id: matches[0].id } : dep;
    });
  }
  state.analysis = analyzeCollection(state.mods);
  render();
}

function renderCollection() {
  const query = $('search-input').value.trim().toLocaleLowerCase('ru');
  const game = $('game-filter').value;
  const filtered = state.mods.filter((m) => (!game || m.game === game) && (!query || `${m.name} ${m.id} ${m.files.map((f) => f.path).join(' ')}`.toLocaleLowerCase('ru').includes(query)));
  $('mod-count').textContent = String(state.mods.length);
  if (!filtered.length) {
    ui.list.innerHTML = '<div class="empty-panel"><div class="empty-orbit">⌁</div><strong>В коллекции пока нет модов</strong><span>Добавь папку или ZIP, чтобы увидеть карту.</span><button class="text-link" id="empty-import" type="button">Добавить первый мод <b>→</b></button></div>';
    $('empty-import').onclick = () => ui.folder.click();
  } else {
    ui.list.innerHTML = filtered.map((m) => `<article class="mod-row"><span class="mod-ordinal">${String((m.order ?? 0) + 1).padStart(2, '0')}</span><div class="mod-main"><strong class="mod-title">${escapeHTML(m.name)}</strong><span class="mod-meta">${escapeHTML(m.game)} · ${Array.isArray(m.files) ? m.files.length : 0} файлов</span></div><span class="mod-enabled ${m.enabled === false ? 'off' : ''}" aria-label="${m.enabled === false ? 'Выключен' : 'Включён'}"></span><button class="text-control mod-toggle" type="button" data-mod="${escapeHTML(m.id)}" aria-label="Переключить мод">${m.enabled === false ? 'Выкл.' : 'Вкл.'}</button><button class="text-control mod-remove" type="button" data-remove="${escapeHTML(m.id)}" aria-label="Удалить мод">×</button></article>`).join('');
    ui.list.querySelectorAll('[data-mod]').forEach((button) => button.addEventListener('click', () => { const m = state.mods.find((x) => x.id === button.dataset.mod); m.enabled = m.enabled === false; updateAnalysis(); }));
    ui.list.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => { state.mods = state.mods.filter((x) => x.id !== button.dataset.remove); updateAnalysis(); }));
  }
  $('clear-button').disabled = state.mods.length === 0;
  $('export-button').disabled = state.mods.length === 0;
  $('compare-button').disabled = state.mods.length === 0 || !state.previous;
  const games = [...new Set(state.mods.map((m) => m.game || 'Не определена'))].sort();
  const selected = $('game-filter').value;
  $('game-filter').innerHTML = '<option value="">Все игры</option>' + games.map((g) => `<option value="${escapeHTML(g)}">${escapeHTML(g)}</option>`).join('');
  $('game-filter').value = games.includes(selected) ? selected : '';
}

function renderFindings() {
  const findings = state.analysis.findings;
  $('metric-mods').textContent = String(state.analysis.summary.totalMods);
  $('metric-files').textContent = String(state.analysis.summary.totalFiles);
  $('metric-findings').textContent = String(findings.length);
  $('finding-count-label').textContent = `${findings.length} ${findings.length === 1 ? 'находка' : 'находок'}`;
  const errors = state.analysis.summary.findingsBySeverity.error;
  const warnings = state.analysis.summary.findingsBySeverity.warning;
  const health = $('health-label');
  health.className = `health-pill ${errors ? 'bad' : warnings ? 'warn' : 'good'}`;
  health.innerHTML = `<i></i> ${errors ? `${errors} требуют внимания` : warnings ? `${warnings} сигнала` : 'Всё спокойно'}`;
  $('view-report').disabled = findings.length === 0;
  if (!findings.length) {
    ui.findings.innerHTML = '<div class="empty-findings"><span>✓</span><p>Явных проблем не найдено. Результат зависит от распознанных метаданных.</p></div>';
    return;
  }
  ui.findings.innerHTML = findings.slice(0, 30).map((f) => `<article class="finding-row"><i class="finding-mark ${escapeHTML(f.severity)}"></i><div class="finding-text"><strong>${escapeHTML(f.code.replaceAll('_', ' '))}</strong><small>${escapeHTML(f.message)}${f.path ? ` · ${escapeHTML(Array.isArray(f.path) ? f.path.join(' → ') : f.path)}` : ''}</small></div></article>`).join('') + (findings.length > 30 ? `<p class="muted">Показаны первые 30 из ${findings.length} находок. Полный список есть в JSON-отчёте.</p>` : '');
}

function renderPaths() {
  const entries = Object.values(state.analysis.pathIndex).filter((entry) => {
    const enabledMods = new Set(entry.entries.filter((e) => e.enabled).map((e) => e.modId));
    return enabledMods.size > 1 && entry.display.toLocaleLowerCase('ru').includes($('path-search').value.trim().toLocaleLowerCase('ru'));
  });
  $('path-count').textContent = String(entries.length);
  ui.paths.innerHTML = entries.length ? entries.map((entry) => `<article class="path-row"><div class="path-name">${escapeHTML(entry.display)}</div><div class="path-meta"><div class="path-mods">${entry.entries.filter((e) => e.enabled).map((e) => `<span>${escapeHTML(state.mods.find((m) => m.id === e.modId)?.name || e.modId)}</span>`).join('')}</div><span>совпадение пути · проверь вручную</span></div></article>`).join('') : '<div class="empty-findings"><span>⌕</span><p>Совпадающих путей пока не найдено.</p></div>';
}

function renderGraph() {
  const nodes = state.analysis.dependencyGraph.nodes;
  const edges = state.analysis.dependencyGraph.edges;
  if (!nodes.length) {
    ui.graph.innerHTML = '<div class="graph-empty"><span class="graph-empty-icon">◎</span><strong>Граф появится после анализа</strong><small>Импортируй сборку с зависимостями.</small></div>';
    $('graph-caption').textContent = 'Ожидает коллекцию';
    return;
  }
  const width = Math.max(640, nodes.length * 150);
  const height = Math.max(260, Math.min(560, 140 + Math.ceil(nodes.length / 4) * 110));
  const positions = new Map(nodes.map((id, i) => [id, { x: 90 + (i % 4) * ((width - 180) / 4), y: 70 + Math.floor(i / 4) * 110 }]));
  const lineSvg = edges.map((e) => { const a = positions.get(e.from), b = positions.get(e.to); return `<path class="graph-edge ${e.kind === 'conflict' ? 'conflict' : ''}" d="M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 - 34} ${b.x} ${b.y}"/>`; }).join('');
  const nodeSvg = nodes.map((id) => { const p = positions.get(id); const m = state.mods.find((x) => x.id === id); return `<g class="graph-node"><rect x="${p.x - 68}" y="${p.y - 24}" width="136" height="48" rx="12"/><text x="${p.x}" y="${p.y + 5}" text-anchor="middle">${escapeHTML((m?.name || id).slice(0, 18))}</text></g>`; }).join('');
  ui.graph.innerHTML = `<div class="graph-canvas"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Граф зависимостей модов"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z"/></marker><marker id="arrow-red" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z"/></marker></defs><g>${lineSvg}</g><g>${nodeSvg}</g></svg></div>`;
  $('graph-caption').textContent = `${nodes.length} модов · ${edges.length} связей из манифестов`;
  $('graph-fit').disabled = false;
}

function render() {
  renderCollection(); renderFindings(); renderPaths(); renderGraph();
  $('collection-meta').textContent = state.mods.length ? `${state.analysis.summary.uniquePaths} путей · ${(state.analysis.summary.totalSize / 1024 / 1024).toFixed(1)} МБ` : 'Сеанс не сохранён автоматически';
  $('version').textContent = '0.2.0';
}

function downloadJSON(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFiles(input, kind) {
  if (!input.files?.length) return;
  hideStatus();
  try {
    if (kind === 'folder') await importFolders(input.files);
    else await importZips(input.files);
    updateAnalysis();
    showStatus(`Добавлено модов: ${state.mods.length}. Анализ выполнен в этой вкладке браузера.`, 'success');
  } catch (error) {
    showStatus(`Импорт остановлен: ${error.message || 'неизвестная ошибка'}. Уже добавленные моды сохранены в сеансе.`, 'error');
    updateAnalysis();
  }
  input.value = '';
}

function loadDemo() {
  state.mods = [
    { id: 'demo-base', name: 'Stellaris Base', game: 'Stellaris', enabled: true, order: 0, files: [{ path: 'common/defines/00_defines.txt', size: 1220, hash: 'demo-a' }], dependencies: [], loadAfter: [], conflictsWith: [] },
    { id: 'demo-civics', name: 'Expanded Civics', game: 'Stellaris', enabled: true, order: 1, files: [{ path: 'common/ideas/civics.txt', size: 3400, hash: 'demo-b' }], dependencies: [{ id: 'demo-base' }], loadAfter: ['demo-base'], conflictsWith: [] },
    { id: 'demo-ui', name: 'UI Overhaul', game: 'Stellaris', enabled: true, order: 2, files: [{ path: 'interface/topbar.gui', size: 820, hash: 'demo-c' }, { path: 'common/defines/00_defines.txt', size: 1300, hash: 'demo-d' }], dependencies: [], loadAfter: [], conflictsWith: [] },
    { id: 'demo-patch', name: 'Civics UI Patch', game: 'Stellaris', enabled: true, order: 3, files: [{ path: 'interface/topbar.gui', size: 840, hash: 'demo-e' }], dependencies: [{ id: 'demo-civics' }], loadAfter: ['demo-ui'], conflictsWith: [] },
  ];
  updateAnalysis(); showStatus('Открыт демонстрационный набор. Он существует только в памяти этой вкладки.', 'success');
}

function importSnapshot(file) {
  if (file.size > 25 * 1024 * 1024) { showStatus('JSON-снимок больше лимита 25 МБ.', 'error'); ui.snapshot.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const value = JSON.parse(reader.result);
      const mods = Array.isArray(value) ? value : value.mods;
      if (!Array.isArray(mods)) throw new Error('в JSON не найден массив модов');
      if (mods.length > 50000) throw new Error('в снимке больше 50 000 модов');
      state.previous = mods;
      if (state.mods.length === 0) state.mods = structuredClone(mods);
      updateAnalysis();
      $('compare-button').disabled = state.mods.length === 0;
      showStatus(`Снимок импортирован: ${mods.length} модов.`, 'success');
    } catch (error) { showStatus(`Не удалось прочитать снимок: ${error.message}`, 'error'); }
    ui.snapshot.value = '';
  };
  reader.readAsText(file);
}

function showComparison() {
  const diff = compareCollections(state.previous || [], state.mods);
  ui.compare.hidden = false;
  ui.compareResults.innerHTML = `<div class="compare-summary"><div class="compare-card"><span>Добавлено</span><strong>${diff.summary.added}</strong></div><div class="compare-card"><span>Удалено</span><strong>${diff.summary.removed}</strong></div><div class="compare-card"><span>Изменено</span><strong>${diff.summary.updated}</strong></div><div class="compare-card"><span>Без изменений</span><strong>${diff.summary.unchanged}</strong></div></div><div class="compare-detail">${[...diff.added.map((x) => ({ ...x, status: 'Добавлен' })), ...diff.removed.map((x) => ({ ...x, status: 'Удалён' })), ...diff.updated.map((x) => ({ ...x, status: 'Изменён' }))].map((x) => `<article class="compare-row"><strong>${escapeHTML(x.status)} · ${escapeHTML(x.name || x.id)}</strong><small>${escapeHTML(x.game || '')}</small>${x.changes ? `<pre>${escapeHTML(JSON.stringify(x.changes, null, 2))}</pre>` : ''}</article>`).join('') || '<p>Снимки совпадают.</p>'}</div>`;
  ui.compare.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('start-import').addEventListener('click', () => ui.folder.click());
$('empty-import')?.addEventListener('click', () => ui.folder.click());
$('folder-input').addEventListener('change', () => importFiles(ui.folder, 'folder'));
$('zip-input').addEventListener('change', () => importFiles(ui.zip, 'zip'));
$('snapshot-input').addEventListener('change', () => ui.snapshot.files?.[0] && importSnapshot(ui.snapshot.files[0]));
$('load-demo').addEventListener('click', loadDemo);
$('search-input').addEventListener('input', renderCollection);
$('game-filter').addEventListener('change', renderCollection);
$('path-search').addEventListener('input', renderPaths);
$('clear-button').addEventListener('click', () => { state.mods = []; state.analysis = analyzeCollection([]); render(); hideStatus(); });
$('export-button').addEventListener('click', () => downloadJSON({ format: 'mod-observatory-snapshot', version: 1, exportedAt: new Date().toISOString(), mods: state.mods, analysis: state.analysis }, 'mod-observatory-report.json'));
$('compare-button').addEventListener('click', showComparison);
$('close-compare').addEventListener('click', () => { ui.compare.hidden = true; });
$('view-report').addEventListener('click', () => $('finding-list').scrollIntoView({ behavior: 'smooth', block: 'center' }));
$('graph-fit').addEventListener('click', () => ui.graph.querySelector('svg')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
$('theme-toggle').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; document.body.dataset.theme = state.theme; });
document.querySelectorAll('.import-actions label[role="button"]').forEach((label) => label.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); label.querySelector('input').click(); }
}));

state.analysis = analyzeCollection([]);
render();
