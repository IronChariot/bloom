# Bloom

Bloom's multi-user web app lives in [web](web/README.md). It includes motion-driven drag deformation, generation-based bubble sizing, centred auto-height text editing, and links that preserve colours. Its Cloudflare Workers and D1 database are deployed, with verified human sign-in and remote MCP collaboration. Open [Bloom](https://bloom.theothersam.workers.dev) or see the [deployment and handoff guide](web/CLOUDFLARE.md).

The original Windows prototype remains in `release/Bloom-win32-x64`. Its executable has not been rebuilt for the web pivot. Your 15-node desktop board was backed up to `artifacts/desktop-board-backup.bloom`; import that file from Bloom's menu to carry it into a hosted board. The backup is excluded from the hosted source repository.

Core checks: `npm test`. Browser collaboration checks: `node tests/web.mjs` against an isolated compiled test Worker at 127.0.0.1:8787. See web/README.md for setup, access rules and MCP details.

The desktop source under electron/ and src/ is retained for reference and can still be run with npm start. This GitHub repository now tracks the complete web source directly. The former nested web Git metadata is backed up locally under ignored artifacts/.
