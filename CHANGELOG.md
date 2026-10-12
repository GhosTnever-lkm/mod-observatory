# Changelog

## 0.2.3 — 2026-10-12

- Version the app module URL so browsers load the matching script after an update instead of reusing a cached older version.
- Check the versioned module URL alongside the displayed and package versions.
- Advance the displayed and package version to 0.2.3.

## 0.2.2 — 2026-10-12

- Exclude Paradox `descriptor.mod` metadata files from shared-path findings and snapshot file diffs.
- Add regression coverage for descriptors at mod root and nested paths.
- Advance the displayed and package version to 0.2.2.

## 0.2.1 — 2026-10-12

- Split nested Paradox mods in a selected collection folder by their nearest `descriptor.mod` directory instead of treating the whole collection as one mod.
- Document collection-folder grouping and add regression coverage for nested and single-mod selections.
- Advance the displayed and package version to 0.2.1.

## 0.2.0 — 2026-10-08

- Translate the project README and remaining public interface labels into Russian.
- Expand the setup guide with import, comparison, privacy, ZIP, format, and contribution details.
- Advance the displayed and package version to 0.2.0.

## 0.1.0 — 2026-10-08

- Add a responsive local-first collection dashboard with library, health summary, path overlaps, and relationship graph.
- Import selected folders, stored/deflate ZIP archives, and JSON snapshots; validate ZIP entry size and CRC before indexing.
- Add iterative dependency/load-order cycle analysis, conflict declarations, exact reported hash matches, and unsafe path findings.
- Compare collection snapshots by stable ID with a cautious unique game/name fallback.
- Add bounded imports, JSON export, privacy and support documentation, Node regression tests, CI, and GitHub Pages deployment workflow.
- Declare limits for ZIP64, encrypted entries, game-specific override semantics, and version-range interpretation.
