# Contributing

## Before opening a change

- Keep archive handling read-only: never extract mod entries to disk or execute their contents.
- Keep browser runtime dependencies at zero unless a proposal explains the size, privacy, and maintenance trade-offs.
- Add a focused regression case for every core behavior change.
- Run `npm test` with Node.js 20 or newer.
- For UI changes, smoke-check the demo, one folder import, one stored/deflate ZIP, JSON export, and snapshot comparison in a browser.
- Update `SUPPORT.md` whenever format or archive coverage changes.

## Reporting results

Describe the exact sample shape used, expected output, and observed output. Do not include private mod files, account tokens, or license data in issues. A shared path is only a review signal; avoid presenting it as proof that mods cannot coexist.
