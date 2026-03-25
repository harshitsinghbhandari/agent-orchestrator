# ADR-001: Replace Flat-File Metadata Store with SQLite

## Status
Implemented

## Context
The AO metadata system uses a flat-file key=value storage approach with one file per session. These files are read and written using `atomicWriteFileSync` which offers single-file guarantees but no cross-file transactional safety. As agent scaling increases, concurrent directory reads (`readdirSync`) race with writes causing state corruption.

## Decision
Migrate the flat-file metadata system to a single SQLite database (`state.db`) using `better-sqlite3`. SQLite provides ACID guarantees, cross-session transaction safety, and WAL mode for excellent concurrent read performance.

## Implementation
- **Affected files**: `packages/core/src/db.ts`, `packages/core/src/metadata-v2.ts`, `packages/core/src/session-manager.ts`
- **Estimated effort**: 3-5d
- **Prerequisites**: None
- **Definition of done**: SQLite database replaces flat-file metadata without breaking existing read/write dependencies, flat-file migrations complete on launch, and corruption loops are eliminated.

## Consequences
- **Positive**: Eliminates state corruption during concurrent updates. Adds ACID guarantees. Easier querying for lists/status.
- **Negative**: Adds a binary dependency (`better-sqlite3`).
- **Risks**: Concurrent processes opening the same DB file need WAL mode correctly configured.
