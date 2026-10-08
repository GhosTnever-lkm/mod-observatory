const SERVICE_FILE = /^(?:readme|license|licence|copying|changelog|thumbnail|desktop\.ini|\.ds_store|\.gitignore|\.gitattributes)(?:\.[a-z0-9_-]+)?$/i;

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function strings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((v) => typeof v === 'string' && v.length > 0))].sort(cmp);
}

function enabled(mod) {
  return mod?.enabled !== false;
}

function servicePath(path) {
  const parts = path.split('/');
  return parts.some((part) => part.toLowerCase() === '.git') || SERVICE_FILE.test(parts.at(-1) ?? '');
}

export function normalizeRelativePath(input) {
  if (typeof input !== 'string' || input.length === 0) return null;
  const path = input.replaceAll('\\', '/');
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return null;
  const parts = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    parts.push(segment);
  }
  if (parts.length === 0) return null;
  const display = parts.join('/');
  return { key: display.toLocaleLowerCase('en-US'), display };
}

function findCycles(adjacency) {
  const reverse = new Map([...adjacency.keys()].map((id) => [id, []]));
  for (const [from, targets] of adjacency) for (const to of targets) reverse.get(to)?.push(from);
  for (const edges of reverse.values()) edges.sort(cmp);

  const visited = new Set();
  const finishOrder = [];
  for (const start of [...adjacency.keys()].sort(cmp)) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack = [{ id: start, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1);
      const edges = adjacency.get(frame.id) ?? [];
      if (frame.next < edges.length) {
        const next = edges[frame.next++];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ id: next, next: 0 });
        }
      } else {
        finishOrder.push(frame.id);
        stack.pop();
      }
    }
  }

  const assigned = new Set();
  const cycles = [];
  for (let i = finishOrder.length - 1; i >= 0; i--) {
    const start = finishOrder[i];
    if (assigned.has(start)) continue;
    const component = [];
    const collect = [start];
    assigned.add(start);
    while (collect.length) {
      const id = collect.pop();
      component.push(id);
      for (const next of reverse.get(id) ?? []) {
        if (!assigned.has(next)) { assigned.add(next); collect.push(next); }
      }
    }
    component.sort(cmp);
    const members = new Set(component);
    const cyclic = component.length > 1 || (adjacency.get(component[0]) ?? []).includes(component[0]);
    if (!cyclic) continue;

    const color = new Map(component.map((id) => [id, 0]));
    const componentAdj = new Map(component.map((id) => [id, (adjacency.get(id) ?? []).filter((next) => members.has(next))]));
    let found = null;
    for (const root of component) {
      if (color.get(root) !== 0 || found) continue;
      const path = [root];
      const positions = new Map([[root, 0]]);
      const stack = [{ id: root, next: 0 }];
      color.set(root, 1);
      while (stack.length && !found) {
        const frame = stack.at(-1);
        const edges = componentAdj.get(frame.id) ?? [];
        if (frame.next >= edges.length) {
          color.set(frame.id, 2);
          positions.delete(path.pop());
          stack.pop();
          continue;
        }
        const next = edges[frame.next++];
        if (color.get(next) === 0) {
          color.set(next, 1);
          positions.set(next, path.length);
          path.push(next);
          stack.push({ id: next, next: 0 });
        } else if (color.get(next) === 1) {
          const cycle = path.slice(positions.get(next));
          const min = cycle.reduce((best, id, index) => cmp(id, cycle[best]) < 0 ? index : best, 0);
          const canonical = [...cycle.slice(min), ...cycle.slice(0, min)];
          found = [...canonical, canonical[0]];
        }
      }
      if (found) cycles.push(found);
    }
  }
  return cycles;
}

function finding(code, severity, message, fields = {}) {
  const modIds = strings(fields.modIds);
  const pathKey = Array.isArray(fields.path) ? fields.path.join('>') : (fields.path ?? '');
  const id = JSON.stringify([code, modIds, pathKey, fields.hash ?? '', fields.missingId ?? '', fields.declaredBy ?? '']);
  return { id, code, severity, message, modIds, ...fields };
}

export function analyzeCollection(mods) {
  const records = Array.isArray(mods) ? mods.filter((m) => m && typeof m === 'object' && typeof m.id === 'string' && m.id.length > 0) : [];
  const byId = new Map();
  const duplicateCounts = new Map();
  for (const mod of records) {
    if (byId.has(mod.id)) duplicateCounts.set(mod.id, (duplicateCounts.get(mod.id) ?? 1) + 1);
    else byId.set(mod.id, mod);
  }

  const findings = [];
  for (const [id, count] of [...duplicateCounts].sort(([a], [b]) => cmp(a, b))) {
    findings.push(finding('DUPLICATE_MOD_ID', 'error', `Mod id "${id}" appears ${count} times; only the first record is analyzed.`, { modIds: [id] }));
  }

  const pathMap = new Map();
  let totalFiles = 0;
  let totalSize = 0;
  for (const mod of byId.values()) {
    for (const file of Array.isArray(mod.files) ? mod.files : []) {
      if (!file || typeof file.path !== 'string') continue;
      totalFiles++;
      if (Number.isFinite(file.size) && file.size >= 0) totalSize += file.size;
      const normalized = normalizeRelativePath(file.path);
      if (!normalized) {
        findings.push(finding('UNSAFE_PATH', 'warning', `Mod "${mod.id}" contains a path that is not a safe relative path.`, { modIds: [mod.id], path: file.path }));
        continue;
      }
      if (servicePath(normalized.display)) continue;
      if (!pathMap.has(normalized.key)) pathMap.set(normalized.key, { key: normalized.key, display: normalized.display, entries: [] });
      pathMap.get(normalized.key).entries.push({
        modId: mod.id,
        enabled: enabled(mod),
        size: Number.isFinite(file.size) && file.size >= 0 ? file.size : null,
        hash: typeof file.hash === 'string' && file.hash.length ? file.hash : null,
      });
    }
  }

  for (const entry of pathMap.values()) {
    entry.entries.sort((a, b) => cmp(a.modId, b.modId) || cmp(a.hash ?? '', b.hash ?? '') || ((a.size ?? -1) - (b.size ?? -1)));
    const active = entry.entries.filter((e) => e.enabled);
    const byMod = new Map();
    for (const item of active) if (!byMod.has(item.modId)) byMod.set(item.modId, item);
    if (byMod.size < 2) continue;
    const modIds = [...byMod.keys()].sort(cmp);
    findings.push(finding('SHARED_PATH', 'warning', `Multiple enabled mods include "${entry.display}"; this is a review signal, not proof of incompatibility.`, { modIds, path: entry.display }));
    const hashes = new Map();
    for (const item of byMod.values()) {
      if (item.hash) {
        if (!hashes.has(item.hash)) hashes.set(item.hash, []);
        hashes.get(item.hash).push(item.modId);
      }
    }
    for (const [hash, ids] of hashes) {
      if (ids.length > 1) findings.push(finding('CONTENT_HASH_MATCH', 'info', `Enabled mods have the same reported content hash for "${entry.display}".`, { modIds: ids, path: entry.display, hash }));
    }
  }

  const dependencyAdj = new Map([...byId.keys()].sort(cmp).map((id) => [id, []]));
  const relationshipEdges = [];
  let versionConstraints = 0;
  for (const mod of byId.values()) {
    const seen = new Set();
    for (const dep of Array.isArray(mod.dependencies) ? mod.dependencies : []) {
      if (!dep || typeof dep.id !== 'string' || dep.id.length === 0) continue;
      if (dep.version !== undefined && dep.version !== null && dep.version !== '') versionConstraints++;
      if (seen.has(dep.id)) continue;
      seen.add(dep.id);
      const optional = dep.optional === true;
      if (!byId.has(dep.id)) {
        if (!optional) findings.push(finding('MISSING_DEPENDENCY', 'error', `Mod "${mod.id}" requires missing dependency "${dep.id}".`, { modIds: [mod.id], missingId: dep.id }));
        continue;
      }
      if (!optional && enabled(mod) && !enabled(byId.get(dep.id))) {
        findings.push(finding('DISABLED_REQUIRED_DEPENDENCY', 'error', `Enabled mod "${mod.id}" requires disabled mod "${dep.id}".`, { modIds: [mod.id, dep.id] }));
      }
      dependencyAdj.get(mod.id).push(dep.id);
      relationshipEdges.push({ from: mod.id, to: dep.id, kind: 'dependency' });
    }
    dependencyAdj.get(mod.id).sort(cmp);
  }
  for (const cycle of findCycles(dependencyAdj)) findings.push(finding('DEPENDENCY_CYCLE', 'error', `Dependency cycle: ${cycle.join(' → ')}.`, { modIds: cycle.slice(0, -1), path: cycle }));

  const loadAdj = new Map([...byId.keys()].sort(cmp).map((id) => [id, []]));
  for (const mod of byId.values()) {
    for (const targetId of strings(mod.loadAfter)) {
      if (!byId.has(targetId)) continue;
      if (targetId === mod.id) {
        findings.push(finding('LOAD_AFTER_CYCLE', 'error', `Mod "${mod.id}" is ordered after itself.`, { modIds: [mod.id], path: [mod.id, mod.id] }));
        continue;
      }
      loadAdj.get(mod.id).push(targetId);
      relationshipEdges.push({ from: targetId, to: mod.id, kind: 'loadAfter' });
      const ownOrder = mod.order;
      const targetOrder = byId.get(targetId).order;
      if (Number.isFinite(ownOrder) && Number.isFinite(targetOrder) && ownOrder < targetOrder) {
        findings.push(finding('LOAD_ORDER_CONFLICT', 'warning', `Declared load-after relation conflicts with the supplied order for "${mod.id}" and "${targetId}".`, { modIds: [mod.id, targetId] }));
      }
    }
    loadAdj.get(mod.id).sort(cmp);
  }
  for (const cycle of findCycles(loadAdj)) findings.push(finding('LOAD_AFTER_CYCLE', 'error', `Load-after cycle: ${cycle.join(' → ')}.`, { modIds: cycle.slice(0, -1), path: cycle }));

  const conflictPairs = new Set();
  for (const mod of byId.values()) {
    for (const targetId of strings(mod.conflictsWith)) {
      if (targetId === mod.id || !byId.has(targetId)) continue;
      const pair = [mod.id, targetId].sort(cmp);
      const pairKey = pair.join('\u0000');
      if (conflictPairs.has(pairKey)) continue;
      conflictPairs.add(pairKey);
      const target = byId.get(targetId);
      const mutual = strings(target.conflictsWith).includes(mod.id);
      const active = enabled(mod) && enabled(target);
      if (cmp(mod.id, targetId) < 0) relationshipEdges.push({ from: mod.id, to: targetId, kind: 'conflict' });
      if (mutual && active) findings.push(finding('DECLARED_CONFLICT', 'warning', `Both enabled manifests declare a conflict between "${pair[0]}" and "${pair[1]}".`, { modIds: pair }));
      else if (!mutual) findings.push(finding('UNILATERAL_CONFLICT', 'info', `Mod "${mod.id}" declares a conflict with "${targetId}", but the reverse declaration is absent.`, { modIds: pair, declaredBy: mod.id }));
    }
  }

  const uniqueFindings = [...new Map(findings.map((item) => [item.id, item])).values()];
  uniqueFindings.sort((a, b) => cmp(a.code, b.code) || cmp(a.modIds.join('\u0000'), b.modIds.join('\u0000')) || cmp(JSON.stringify(a.path ?? ''), JSON.stringify(b.path ?? '')) || cmp(a.hash ?? '', b.hash ?? ''));
  const findingsByCode = {};
  const findingsBySeverity = { error: 0, warning: 0, info: 0 };
  for (const item of uniqueFindings) {
    findingsByCode[item.code] = (findingsByCode[item.code] ?? 0) + 1;
    findingsBySeverity[item.severity]++;
  }
  const pathIndex = Object.create(null);
  for (const key of [...pathMap.keys()].sort(cmp)) pathIndex[key] = pathMap.get(key);
  const dependencyGraph = {
    nodes: [...byId.keys()].sort(cmp),
    edges: relationshipEdges.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.from, b.from) || cmp(a.to, b.to)),
  };
  return {
    summary: {
      totalMods: byId.size,
      enabledMods: [...byId.values()].filter(enabled).length,
      disabledMods: [...byId.values()].filter((m) => !enabled(m)).length,
      duplicateIdCount: duplicateCounts.size,
      totalFiles,
      totalSize,
      uniquePaths: pathMap.size,
      findingsByCode,
      findingsBySeverity,
      uninterpretedVersionConstraints: versionConstraints,
    },
    findings: uniqueFindings,
    pathIndex,
    dependencyGraph,
  };
}

function fileIndex(mod) {
  const map = new Map();
  for (const file of Array.isArray(mod.files) ? mod.files : []) {
    if (!file || typeof file.path !== 'string') continue;
    const path = normalizeRelativePath(file.path);
    if (!path || servicePath(path.display) || map.has(path.key)) continue;
    map.set(path.key, { path: path.display, size: Number.isFinite(file.size) ? file.size : null, hash: file.hash ?? null });
  }
  return map;
}

function dependencyIndex(mod) {
  const map = new Map();
  for (const dep of Array.isArray(mod.dependencies) ? mod.dependencies : []) {
    if (dep && typeof dep.id === 'string' && !map.has(dep.id)) map.set(dep.id, { optional: dep.optional === true, version: dep.version ?? null });
  }
  return map;
}

function setDelta(before, after) {
  const b = new Set(before);
  const a = new Set(after);
  return { added: [...a].filter((x) => !b.has(x)).sort(cmp), removed: [...b].filter((x) => !a.has(x)).sort(cmp) };
}

function diffMod(before, after) {
  const changes = {};
  for (const key of ['name', 'game', 'order']) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (!Object.is(from, to)) changes[key] = { from, to };
  }
  if (enabled(before) !== enabled(after)) changes.enabled = { from: enabled(before), to: enabled(after) };

  const oldFiles = fileIndex(before);
  const newFiles = fileIndex(after);
  const files = { added: [], removed: [], changed: [] };
  for (const [key, value] of newFiles) {
    const old = oldFiles.get(key);
    if (!old) files.added.push(value.path);
    else if (old.size !== value.size || old.hash !== value.hash) files.changed.push({ path: value.path, before: { size: old.size, hash: old.hash }, after: { size: value.size, hash: value.hash } });
  }
  for (const [key, value] of oldFiles) if (!newFiles.has(key)) files.removed.push(value.path);
  files.added.sort(cmp); files.removed.sort(cmp); files.changed.sort((a, b) => cmp(a.path, b.path));
  if (files.added.length || files.removed.length || files.changed.length) changes.files = files;

  const oldDeps = dependencyIndex(before);
  const newDeps = dependencyIndex(after);
  const depIds = setDelta([...oldDeps.keys()], [...newDeps.keys()]);
  const depChanged = [...oldDeps.keys()].filter((id) => newDeps.has(id) && (oldDeps.get(id).optional !== newDeps.get(id).optional || oldDeps.get(id).version !== newDeps.get(id).version));
  if (depIds.added.length || depIds.removed.length || depChanged.length) {
    changes.dependencies = {
      added: depIds.added.map((id) => ({ id, ...newDeps.get(id) })),
      removed: depIds.removed.map((id) => ({ id, ...oldDeps.get(id) })),
      changed: depChanged.sort(cmp).map((id) => ({ id, before: oldDeps.get(id), after: newDeps.get(id) })),
    };
  }
  for (const field of ['loadAfter', 'conflictsWith']) {
    const delta = setDelta(strings(before[field]), strings(after[field]));
    if (delta.added.length || delta.removed.length) changes[field] = delta;
  }
  return Object.keys(changes).length ? changes : null;
}

function collectionIndex(collection) {
  const map = new Map();
  for (const mod of Array.isArray(collection) ? collection : []) {
    if (mod && typeof mod === 'object' && typeof mod.id === 'string' && mod.id.length > 0 && !map.has(mod.id)) map.set(mod.id, mod);
  }
  return map;
}

function identityKey(mod) {
  if (typeof mod.game !== 'string' || !mod.game.trim() || typeof mod.name !== 'string' || !mod.name.trim()) return null;
  return `${mod.game.trim().toLocaleLowerCase('en-US')}\u0000${mod.name.trim().toLocaleLowerCase('en-US')}`;
}

function publicMod(mod) {
  return { id: mod.id, name: typeof mod.name === 'string' ? mod.name : '', game: typeof mod.game === 'string' ? mod.game : '' };
}

export function compareCollections(before, after) {
  const oldMods = collectionIndex(before);
  const newMods = collectionIndex(after);
  const unmatchedOld = new Map(oldMods);
  const unmatchedNew = new Map(newMods);
  const pairs = [];
  for (const id of [...oldMods.keys()].sort(cmp)) {
    if (!newMods.has(id)) continue;
    unmatchedOld.delete(id); unmatchedNew.delete(id);
    pairs.push({ before: oldMods.get(id), after: newMods.get(id), matchedBy: 'id' });
  }

  const newByIdentity = new Map();
  for (const [id, mod] of [...unmatchedNew].sort(([a], [b]) => cmp(a, b))) {
    const key = identityKey(mod);
    if (!key) continue;
    if (!newByIdentity.has(key)) newByIdentity.set(key, []);
    newByIdentity.get(key).push([id, mod]);
  }
  for (const [oldId, mod] of [...unmatchedOld].sort(([a], [b]) => cmp(a, b))) {
    const key = identityKey(mod);
    const candidates = key ? newByIdentity.get(key) : null;
    if (!candidates || candidates.length !== 1) continue;
    const [newId, next] = candidates[0];
    const oldCandidateCount = [...unmatchedOld.values()].filter((item) => identityKey(item) === key).length;
    if (oldCandidateCount !== 1) continue;
    unmatchedOld.delete(oldId); unmatchedNew.delete(newId); newByIdentity.delete(key);
    pairs.push({ before: mod, after: next, matchedBy: 'game+name' });
  }

  const added = [...unmatchedNew.values()].map(publicMod).sort((a, b) => cmp(a.id, b.id));
  const removed = [...unmatchedOld.values()].map(publicMod).sort((a, b) => cmp(a.id, b.id));
  const updated = [];
  const unchanged = [];
  for (const pair of pairs) {
    let changes = diffMod(pair.before, pair.after);
    if (pair.before.id !== pair.after.id) {
      if (!changes) changes = {};
      changes.id = { from: pair.before.id, to: pair.after.id };
    }
    if (changes) updated.push({ id: pair.after.id, previousId: pair.before.id, matchedBy: pair.matchedBy, name: pair.after.name ?? '', game: pair.after.game ?? '', changes });
    else unchanged.push({ id: pair.after.id, previousId: pair.before.id, matchedBy: pair.matchedBy });
  }
  updated.sort((a, b) => cmp(a.id, b.id));
  unchanged.sort((a, b) => cmp(a.id, b.id));
  return {
    summary: { totalBefore: oldMods.size, totalAfter: newMods.size, added: added.length, removed: removed.length, updated: updated.length, unchanged: unchanged.length },
    added, removed, updated, unchanged,
  };
}
