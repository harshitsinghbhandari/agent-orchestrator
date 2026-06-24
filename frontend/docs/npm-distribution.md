# npm distribution (bootstrapper)

How Agent Orchestrator (AO) ships as an `npm i -g` install, what the package
actually does, and the plan to build it. This sits next to
[`desktop-release.md`](desktop-release.md), which covers the GitHub Release and
auto-update side; read that first for context on how the app is built and
published today.

## TL;DR

`npm i -g @aoagents/ao` installs a thin, one-time **bootstrapper**, not the app
itself. On install it downloads the portable Electron bundle for the user's
platform from the matching GitHub Release, verifies it, unpacks it, and globally
links an `ao` launcher. The first time the app runs it self-installs into
/Applications (or the Linux equivalent). After that, the app's own auto-updater
owns every future update. npm is published **once** (v0.10.0) and is never the
update path.

The desktop app is the product. npm is only a delivery channel, added alongside
the existing direct downloads (`.dmg` / `.deb` / NSIS `.exe`), not replacing
them.

## Why a bootstrapper and not a bundled binary

The shippable artifact is the Electron desktop app. The Go `ao` daemon is already
compiled into that app by `scripts/build-daemon.mjs` and shipped as an
`extraResource` (`daemon/ao`). There is no separate standalone Go binary to
distribute, and we do not want to create one: the binary the user needs already
lives inside the Electron bundle.

That rules out the esbuild / turbo style of npm packaging (one tiny per-arch npm
package per platform, each carrying a small native binary, selected by npm via
`os` / `cpu` fields). An Electron bundle is large and is already published as a
GitHub Release asset, so the natural fit is: download the existing release asset
at install time. That is the postInstall-download pattern. We use a **single**
npm package that fetches at install time, with **no** per-arch sub-packages,
because the os/cpu split buys nothing once the payload comes from a Release.

## Supported targets

Four targets in this round:

| Target         | Release asset                              |
| -------------- | ------------------------------------------ |
| `darwin-arm64` | `agent-orchestrator-darwin-arm64.zip`      |
| `darwin-x64`   | `agent-orchestrator-darwin-x64.zip`        |
| `linux-x64`    | `agent-orchestrator-linux-x64.tar.gz`      |
| `linux-arm64`  | `agent-orchestrator-linux-arm64.tar.gz`    |

Windows is **out of scope** for npm in this round. The NSIS `.exe` installer
stays the Windows path. Any unsupported platform or architecture (Windows,
`linux-ia32`, etc.) fails the install loudly with a pointer to the Releases page,
exits non-zero, and never leaves a half-installed package behind.

## Install-time flow (the bootstrapper)

1. **Detect** `process.platform` + `process.arch`, map to one of the four assets.
   Unsupported combination: fail loudly, non-zero exit.
2. **Resolve the release** by exact version pin. npm `@x.y.z` fetches the GitHub
   Release tagged `desktop-v x.y.z`. The npm version is the app version. The
   intended (and only) npm release is `0.10.0`, which fetches `desktop-v0.10.0`.
3. **Download** the asset and the `SHA256SUMS` file using Node 20's built-in
   `fetch` / `https` (zero runtime dependencies). Respect `HTTP(S)_PROXY` and npm
   proxy config; retry 3 times with backoff.
4. **Verify** the asset's SHA-256 against `SHA256SUMS` **before** unpacking. A
   mismatch or a missing asset is a hard, loud failure.
5. **Unpack** into the npm package's own directory. Nothing is written under
   `~/Library/Application Support` or any OS-default app-data location; the repo
   rule is that AO app state lives under `~/.ao` only, and the relocation to
   /Applications is the app's job, not the installer's.
6. **Link** the global `ao` launcher (npm `bin`).

macOS bundles are **signed and notarized** (signing credentials are in place), so
downloaded apps pass Gatekeeper. No quarantine-xattr workaround is needed.

## The `ao` launcher

`ao` is a thin launcher that opens the desktop app detached. It is **not** the Go
CLI; the app is the product and the launcher exists to start it.

The launcher is also self-healing. If the platform bundle is missing when `ao`
runs (the common cause is `npm install --ignore-scripts`, which skips
`postinstall` entirely, a frequent supply-chain precaution in hardened CI), the
launcher runs the same download-and-verify logic first, then launches. So
postinstall is the fast path and the launcher is the fallback: the package works
either way, and `--ignore-scripts` users simply pay the download on their first
`ao` instead of at install time.

## First-run self-install (in the app)

The bundle the bootstrapper unpacks is portable. The app installs itself properly
on first launch, guarded by `app.isPackaged` and an "already installed" check so
it is a no-op in `npm run dev` and after the first run.

- **macOS:** call Electron's built-in `app.moveToApplicationsFolder()` when the
  app is not already running from /Applications.
- **Linux:** there is no /Applications equivalent. Unpack to
  `~/.local/opt/agent-orchestrator`, write a `.desktop` entry plus icon into
  `~/.local/share/applications`, and symlink the launcher onto PATH. All
  user-level, no sudo.

This lives in `frontend/src/main.ts` next to the existing
`initAutoUpdates()` wiring.

## Versioning and updates

npm is a one-time bootstrap. The package ships once at `0.10.0`. Every update
after that flows through the app's in-app auto-updater
(`update-electron-app`, already wired in `main.ts`) via the GitHub Releases feed.
`npm update -g` is explicitly **not** the update path, and the README says so to
avoid confusion.

## Release-asset prerequisites (CI changes)

Today the Release publishes OS **installers** (macOS `.zip`, Windows NSIS `.exe`,
Linux `.deb` / `.rpm`) and the build matrix covers only `macos-latest` (arm64)
and `windows-latest`, with `ubuntu-latest` (x64) in the testing build. Two of the
four npm targets (`darwin-x64`, `linux-arm64`) have no asset yet, and Linux ships
only a `.deb` installer rather than a portable archive. The bootstrapper needs
portable, unpack-and-run archives per `(os, arch)`, so the Release must produce
them first:

- Add a `maker-zip` for Linux in `forge.config.ts` (alongside the existing
  deb / rpm makers) to get a portable Linux tarball.
- Normalize artifact names to `agent-orchestrator-<os>-<arch>.{zip,tar.gz}`.
- Expand `frontend-release.yml` matrix: `macos-latest` (arm64), `macos-13` (x64),
  `ubuntu-latest` (x64), and an arm64 Linux runner. The arm64 Linux runner is
  attempted first; if it requires a paid runner tier it is deferred and
  `linux-arm64` lands in a follow-up.
- Publish a `SHA256SUMS` asset covering all archives.
- After the assets and checksums land, the same `desktop-v*` workflow publishes
  the npm bootstrapper.

## Package layout

A single new package directory (proposed `packages/installer/`; the exact path is
a small build-time call, since the legacy `packages/*` tree is currently
untracked). Contents:

```
package.json    bin.ao, postinstall, publishConfig.access=public, scope var
install.js      detect -> map -> fetch -> SHA256 verify -> unpack -> place
bin/ao.js       launch detached + lazy-fetch fallback
README.md       one-line install + "this is a bootstrapper, app auto-updates"
```

The publish scope is a single configuration variable. Real releases publish under
`@aoagents`; a personal staging scope is used only for dry runs and is the same
one variable flipped. `publishConfig.access` is set to `public` so scoped
publishes do not fail.

## Build plan (batched)

**Batch A (parallel, independent of each other)**

- **A1. Release assets + checksums.** `forge.config.ts` Linux `maker-zip`;
  `frontend-release.yml` matrix expansion (`darwin-x64` via `macos-13`,
  `linux-arm64` attempt), canonical `agent-orchestrator-<os>-<arch>` naming,
  publish `SHA256SUMS`. Verify a `desktop-v*` dry run produces all four archives
  plus the checksum file.
- **A2. App first-run self-install.** `frontend/src/main.ts`: macOS
  `moveToApplicationsFolder()` and Linux `~/.local/opt` + `.desktop` + PATH
  symlink, guarded for dev and no-op after install.

**Batch B (depends on A1: final asset names + workflow)**

- **B1. npm bootstrapper package.** New package dir: `package.json` (bin,
  postinstall, public access, scope var), `install.js` (detect, map, fetch,
  SHA-256 verify, unpack, place, with loud failure paths including the Windows
  rejection), `bin/ao.js` (detached launch + lazy-fetch fallback), `README.md`.
- **B2. npm publish in CI.** Extend `frontend-release.yml` to `npm publish` the
  bootstrapper after the Release assets land, scope-parameterized for the staging
  dry run versus `@aoagents`.

**Batch C (depends on A + B)**

- **C1. End-to-end verification.** Acceptance bar: on a clean macOS arm64, an
  Intel Mac, and a linux-x64 box, `npm i -g @aoagents/ao && ao` fetches,
  self-installs to /Applications (or the Linux equivalent), and the app launches
  with a working daemon. `linux-arm64` is verified in CI if no hardware is
  available. Dry-run the full tag to assets to npm-publish chain on the staging
  scope first.

## Out of scope

- Windows via npm (NSIS installer stays the Windows path).
- npm as an update channel (the app's auto-updater owns updates; only `0.10.0`
  ships to npm).
- Per-arch optional-dependency sub-packages.
- Any telemetry beyond what the app already does.
