# Bloom

The active version is now the hosted multi-user app in [web](web/README.md). It includes motion-driven drag deformation, generation-based bubble sizing, centred auto-height text editing, and links that preserve colours.

The original Windows prototype remains in `release/Bloom-win32-x64`. Its executable has not been rebuilt for the web pivot. Your 15-node desktop board was backed up to `artifacts/desktop-board-backup.bloom`; import that file from Bloom's menu to carry it into a hosted board. The backup is excluded from the hosted source repository.

Core checks: `npm test`. Browser collaboration checks: `node tests/web.mjs` against an isolated compiled test Worker at 127.0.0.1:8787. See web/README.md for setup, access rules and MCP details.

The desktop source under electron/ and src/ is retained for reference and can still be run with npm start. Hosted application source is independent under web/; its Git repository and deployment identity are rooted there.
