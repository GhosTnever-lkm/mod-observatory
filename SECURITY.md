# Security policy

## Scope

The browser app reads user-selected folders, ZIP archives, and JSON snapshots. It does not execute mod code, extract archive entries to disk, contact a backend, or modify game files.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when available. Include the affected release, browser, a minimal synthetic reproducer, and the impact. Do not publish real mod files, private collection data, account credentials, or tokens in an issue.

## Limits

This tool is not an antivirus scanner. CRC and size validation detect some archive corruption, but do not establish that files are safe. The findings help review collection metadata; they do not guarantee compatibility or correctness.
