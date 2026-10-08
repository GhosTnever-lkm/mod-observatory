# Mod Observatory

**A local-first control room for game mod collections.** Index files from folders and ZIP archives, inspect declared dependencies and ordering hints, map path overlaps, and compare saved collection snapshots.

[Open the app](https://ghostnever-lkm.github.io/mod-observatory/) · [Download the latest release](https://github.com/GhosTnever-lkm/mod-observatory/releases/latest) · [Report a problem](https://github.com/GhosTnever-lkm/mod-observatory/issues)

## What it does

- Imports selected mod folders, ZIP archives, or a previously exported collection snapshot.
- Builds a case-insensitive file-path index and relationship graph from supported metadata.
- Reports missing or disabled dependencies, dependency and load-after cycles, declared conflicts, shared paths, exact reported hash matches, and unsafe relative paths.
- Compares snapshots and lists additions, removals, metadata changes, file changes, dependency changes, and order changes.
- Filters by game, mod, or path; exports JSON without embedding file contents.

The app does not install, enable, reorder, patch, or modify mods. A repeated path is a review signal, not proof of incompatibility. Version constraints are counted but not interpreted as a universal version language. Unknown manifests are not guessed into dependencies.

## Quick start

1. Open the [hosted app](https://ghostnever-lkm.github.io/mod-observatory/).
2. Select one or more mod folders or ZIP archives. Files are read locally by the current browser tab.
3. Review the collection summary, findings, and relationship graph.
4. Export a report, or import an older JSON snapshot and compare it with a new collection.

To run a local copy, serve this folder over HTTP, for example with `python -m http.server 8000`, then open `http://localhost:8000`. Opening ES modules directly through `file://` is blocked by many browsers.

## Metadata support

The first adapter reads Paradox `descriptor.mod` names and dependency names. Dependencies are connected to imported mods only when a name matches one unique imported mod. Other supported entries are indexed as files; game-specific override behavior is not inferred. See [SUPPORT.md](SUPPORT.md) for limits.

## Privacy and safety

- No backend, analytics, external script, or upload endpoint.
- Selected files are processed in the browser tab; exports contain metadata only.
- The app does not execute scripts, DLLs, plugins, or mod code.
- ZIP entries are not extracted to disk. Supported entries are checked against declared size and CRC.
- Imports are limited to 50,000 files and 512 MiB. Snapshot JSON is limited to 25 MiB and 50,000 mods.
- No collection is saved automatically. Use explicit JSON export/import to move a snapshot.

## Development

Requires Node.js 20 or newer for the regression suite. The app has no build step or runtime dependency.

```sh
npm test
```

## Free and Pro

The core edition is free and open source. Optional support: [Buy Me a Coffee](https://buymeacoffee.com/azizazimov8) · [Boosty](https://boosty.to/azimovian) · [Gumroad](https://azimovian22.gumroad.com/).

The Pro edition is being scoped around saved workspaces, multi-snapshot history, richer export formats, and expanded game adapters. It will be offered after those features and their delivery are ready.

## License

MIT. See [LICENSE](LICENSE).
