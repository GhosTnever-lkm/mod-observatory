# Format support and limitations

## 0.1.x

| Input | Read in this release | Not inferred |
| --- | --- | --- |
| Selected folder | Relative paths, byte sizes, SHA-256 when available, Paradox `descriptor.mod` name and dependency names | Game-specific override behavior; dependencies from unknown manifest formats |
| ZIP archive | Stored and deflate entries, central-directory paths, sizes, CRC validation, supported descriptor text | ZIP64, encryption, unsupported compression methods, malformed entries; archives are not extracted to disk |
| Snapshot JSON | Mod IDs, names, games, enabled state, order, dependencies, file metadata, and reported hashes | Missing hashes cannot be recreated; imported JSON is treated as user-provided data |

## Safety and interpretation

- ZIP paths are untrusted metadata. Absolute paths, drive paths, and parent traversal paths are excluded from the index and reported.
- Folder and archive imports are limited to 50,000 files and 512 MiB per import. Snapshot JSON is limited to 25 MiB and 50,000 mod records.
- Size and CRC checks detect many damaged ZIP entries; they do not prove an archive is trustworthy.
- A same-path finding does not prove two mods conflict. The game may merge, override, or ignore files differently.
- Version strings and dependency ranges vary by game. This release does not interpret their syntax.
- Dependency cycles are reported once per strongly connected group, not as every possible simple cycle.
- The tool is not an antivirus scanner or a guarantee that an archive is safe.
- Folder import groups by the top-level directory selected in the browser. Unusual package nesting may require importing a ZIP instead.
