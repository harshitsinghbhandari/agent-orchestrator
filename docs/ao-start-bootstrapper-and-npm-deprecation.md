# `ao start` Bootstrapper + npm Deprecation: Implementation Spec

> **Status:** ready for build (Track A). Grounded against the real codebase on
> branch `feat/ao-start-bootstrapper` (= `upstream/main` + PR #2185) on 2026-06-26.
> Every "current state" claim below carries a `file:line` reference. Where the
> original draft (`somthing.md`) assumed facts, this document replaces them with
> what the code actually says.

---

## 0. Goal

Turn npm from a **parallel app-distribution path** (the real source of version
skew) into a **one-time on-ramp**. The npm package `@aoagents/ao` stops shipping
the Electron app. Its only job becomes: provide an `ao start` command that
fetches the current desktop app from GitHub Releases, opens it, and tells the
user that future installs/updates happen via the website + the app's own
auto-updater, not npm.

The canonical, auto-updating app is the GitHub/website build. npm `ao start` is a
thin, version-agnostic client that hands off to it.

---

## 1. Ground truth (what the code actually is today)

This section is the "real stuff." It is the contract the build rests on; if any
of it changes, revisit the dependent task.

### 1.1 App identity and release target

| Fact | Value | Source |
|---|---|---|
| Product / bundle name | **`Agent Orchestrator.app`** (spaced) | `frontend/forge.config.ts:9,50` |
| Bundle id | `dev.agent-orchestrator.desktop` | `frontend/forge.config.ts:8` |
| Executable name | `agent-orchestrator` | `frontend/forge.config.ts` (packagerConfig) |
| Publish repo | **`aoagents/agent-orchestrator`** (NOT "ReverbCode") | `frontend/forge.config.ts:86` |
| GitHub release mode | **`draft: true`**, `prerelease: false` | `frontend/forge.config.ts` (publisher-github) |

> The original draft's `OWNER/REPO = aoagents/ReverbCode` and bundle `ao.app` are
> both wrong. `reverbcode/main` ships the identical `Agent Orchestrator` build;
> there is no separate "ao" product.

### 1.2 Release / build pipeline

- Workflow: `.github/workflows/frontend-release.yml`.
  - Triggers: push tag `desktop-v*`, `workflow_dispatch`.
  - **Matrix: `[macos-latest, windows-latest]` only, no Linux** (`:28`). deb/rpm
    makers are configured but never run. (Filed upstream as
    AgentWrapper/agent-orchestrator#2191.)
  - Build step: `npm run publish` → `npm run build:daemon && electron-forge publish`
    (`frontend/package.json` `publish`).
- Makers (`frontend/forge.config.ts`, `frontend/makers/maker-nsis.ts`):
  | Platform | Maker | Emitted artifact (today) |
  |---|---|---|
  | macOS (arm64+x64) | `@electron-forge/maker-zip` | versioned `.zip` under `out/make/zip/darwin/<arch>/` |
  | Windows | `MakerNSIS` (electron-builder NSIS) | `out/make/Agent Orchestrator Setup.exe` (per-user installer) |
  | Linux | `@electron-forge/maker-deb` | `agent-orchestrator-<version>.deb` |
  | Linux | `@electron-forge/maker-rpm` | `agent-orchestrator-<version>.rpm` |
- **No asset-rename step exists.** Emitted names embed `productName`/version, so a
  constant `releases/latest/download/<stable-name>` URL cannot resolve yet.
- **Releases are drafts.** `draft: true` means `/releases/latest/download/` 404s
  until a human (or a new CI step) finalizes the release.

### 1.3 Versioning

- Frontend: `frontend/package.json` `version: "0.0.0"`.
- Daemon: `backend/internal/cli/version.go:12` `Version = "dev"`.
- `frontend/scripts/build-daemon.mjs` runs `go build ./cmd/ao` with **no
  `-ldflags`**, so the daemon version is never injected from the tag.
- Net: there is no real semver anywhere. The release-cut process (tag → bump
  `package.json` → ldflags) is manual and partly unimplemented.

### 1.4 Signing / notarization / auto-update

- `osxSign` is gated on `APPLE_SIGNING_IDENTITY` **or** `CSC_LINK`;
  `osxNotarize` on `AO_NOTARY_PROFILE` **or** `APPLE_ID` (`frontend/forge.config.ts:24-40`).
- Those secrets are **not configured in CI**, and the workflow header comment
  (`frontend-release.yml:13-15`) states published builds are **UNSIGNED** and
  will **not** auto-update on macOS.
- **Auto-update is already wired** (correcting the draft): `frontend/src/main.ts:14`
  imports `updateElectronApp` from `update-electron-app`; `initAutoUpdates()`
  (`main.ts:817`) calls it, but only when `app.isPackaged`. Its own comment
  (`main.ts:813-816`) says a live updater additionally requires a signed +
  notarized build. So the updater exists; it is inert because builds are unsigned
  and the version is `0.0.0`.

### 1.5 `~/.ao` state and app lifecycle

- Canonical home: `~/.ao` (override `AO_DATA_DIR` / `AO_RUN_FILE`).
  Resolved at `backend/internal/config/config.go:296` (`defaultStateDir`),
  mirrored in the app at `frontend/src/shared/daemon-discovery.ts:107`.
- Electron `userData` is pinned to `~/.ao/electron` (`frontend/src/main.ts:64`),
  before `app.whenReady()`. Do not remove (CLAUDE.md hard rule).
- `~/.ao/running.json` is written by the **daemon** (`backend/internal/runfile/runfile.go`
  `Write`, atomic temp-file + rename), `Owner` from `AO_OWNER`; the app only
  **reads** it (`daemon-discovery.ts` `parseRunFile`). Today the only JSON in
  `~/.ao` is `running.json`; **`app-state.json` does not exist yet.**
- App startup (`main.ts:822` `app.whenReady`): `registerRendererProtocol()` →
  `createWindow()` → `void startDaemon()` → `initAutoUpdates()`.
- `app.moveToApplicationsFolder()` is **not used anywhere** (macOS-only API).
- Login-shell env is resolved once at startup via `zsh -ilc '… env -0'`
  (`frontend/src/shared/shell-env.ts:27`, awaited at the daemon-spawn chokepoint).

### 1.6 Packaging / workspace state

- Root is **npm** (`package-lock.json`, lockfileVersion 3), `private: true`, **no
  `workspaces`**, no `engines`, no `packageManager` field.
- `frontend/` is a **separate install** (its own `pnpm-lock.yaml` + a
  `package-lock.json`; pnpm 10.11.1; frontend-only `pnpm-workspace.yaml` with
  `nodeLinker: hoisted` for electron-forge).
- CI Node version: **20** (`frontend-release.yml:39`).
- The only `postinstall` in the tree is `frontend/src/landing/package.json`
  (`fumadocs-mdx`), isolated to the docs site, zero impact on a new package.
- **No npm-registry publish infrastructure** exists (only electron-forge →
  GitHub Releases). No `NPM_TOKEN`, no changesets/release-please.

---

## 2. Decisions locked (from the interview)

1. **Scope = Track A only now.** Build the launcher + the app-state marker. The
   "npm is deprecated because the app auto-updates itself" narrative is **Track B**
   and out of scope for this effort; de-scope auto-update promises from v1 copy.
2. **Package home = `packages/` workspace** in this monorepo, published as
   `@aoagents/ao`, versioned with the app.
3. **Platforms = all three.** **Windows installer is NSIS** (not Squirrel).
4. **App-side work is in scope**, and the marker file is **`~/.ao/app-state.json`**
   (not `install.json`).

---

## 3. Scope

**In scope (Track A):**
- npm package `@aoagents/ao` with an `ao start` command: resolve → fetch → open →
  print deprecation notice. All other subcommands print a deprecation notice.
- App-side: write `~/.ao/app-state.json` on every launch (single-writer = the
  app); own `moveToApplicationsFolder()` relocation (macOS).
- Release wiring so the launcher's constant URL works: stable version-free asset
  names + finalize-the-draft (or a Releases-API fallback).
- macOS / Windows (NSIS) / Linux (deb/rpm or AppImage) fetch+open paths.

**Explicitly out of scope (Track B, separate effort):**
- Real version stamping (app + daemon) from the release tag.
- Making the already-wired `update-electron-app` updater functional (needs
  signing + real version).
- Configuring macOS signing/notarization secrets in CI.
- Any in-app copy that *promises* auto-update.

---

## 4. Core invariants (load-bearing)

1. **The npm package runs zero install scripts.** No `preinstall`/`install`/
   `postinstall`, no `binding.gyp` in its dep tree. Pure tarball unpack. (npm v12,
   est. July 2026, blocks unapproved install scripts by default; this sidesteps it.)
2. **Filesystem is the source of truth; the marker is a fast-path hint.** Never
   trust `app-state.json`'s recorded path without `stat`-ing it first.
3. **The app is the sole writer of `app-state.json`.** The bootstrapper is
   read-only with respect to it. This is what makes the npm and website install
   routes converge without an orphaned second copy.
4. **The app owns relocation.** `moveToApplicationsFolder()` lives in the app;
   after relocating, the app rewrites the marker path. The bootstrapper never
   moves the app.
5. **`ao start` is dumb about versions.** Its only decision is *present or absent*.
   It never compares versions. An installed-but-old app is the in-app updater's
   job, never the bootstrapper's.
6. **Resolution order is fixed:** marker path → `stat` → known-location scan →
   fetch. Fetch only when both the marker and the scan miss.
7. **Stable, version-free release asset names** so the bootstrapper uses a
   constant URL and stays version-agnostic.

---

## 5. The marker contract: `~/.ao/app-state.json`

New file, app-written, mirroring the proven `running.json` atomic-write pattern
(`backend/internal/runfile/runfile.go`): write a temp file in the same dir, then
atomic rename, so a reader never sees a partial file.

### Schema

```json
{
  "schemaVersion": 1,
  "appPath": "/Applications/Agent Orchestrator.app",
  "version": "0.0.0",
  "installedAt": "2026-06-26T10:00:00Z",
  "lastReconciledAt": "2026-06-26T10:05:00Z",
  "installSource": "npm-bootstrap"
}
```

| Field | Writer | Meaning |
|---|---|---|
| `schemaVersion` | app | Marker format version. |
| `appPath` | app | Absolute path to the bundle as of the last launch. |
| `version` | app | The app's own version (`app.getVersion()`). For the tour/migration, NOT for bootstrapper update decisions. |
| `installedAt` | app | First time the marker was written. |
| `lastReconciledAt` | app | Last launch that touched the marker. |
| `installSource` | app | How the app first arrived (`npm-bootstrap` / `website` / `github` / `unknown`). Recorded only on first marker creation. |

### Ownership rules

- **Only the app writes it**, on **every launch** (not just first run): it sets
  `appPath` to its own current bundle location and `version` to its own version,
  and updates `lastReconciledAt`. This self-heals a stale/missing marker no matter
  how the app arrived (npm fetch, website download, manual move).
- **The bootstrapper only reads it**, and only after `stat`-ing the path. If the
  bootstrapper ever needs to record anything (e.g. analytics), it uses a separate
  file, never these fields.

---

## 6. The npm package `@aoagents/ao`

### 6.1 Workspace wiring (grounded in §1.6)

The root is npm with no workspaces today. Two viable paths; **default to npm
workspaces** (least disruption, matches the root lockfile):

- Add `"workspaces": ["frontend", "packages/*"]` to root `package.json`.
- Create `packages/launcher/` with the package below.
- (Alternative, if aligning with the stated pnpm intent: a root
  `pnpm-workspace.yaml` folding in `frontend` + `packages/**`. Heavier; decide at
  build time, see §11.)

The launcher is **dependency-free** (Node 18+ built-ins: `fetch`, `fs`,
`child_process`), so workspace choice only affects dev ergonomics and publish, not
runtime.

### 6.2 package.json

```json
{
  "name": "@aoagents/ao",
  "version": "0.0.0",
  "description": "Launcher for the Agent Orchestrator desktop app. Fetches and opens the app; the app is distributed via the website and GitHub Releases.",
  "bin": { "ao": "./bin/ao.js" },
  "type": "module",
  "engines": { "node": ">=18" },
  "files": ["bin/", "src/"],
  "os": ["darwin", "win32", "linux"],
  "publishConfig": { "registry": "https://registry.npmjs.org" }
}
```

Hard rules: no `scripts.preinstall|install|postinstall`; no
`optionalDependencies` platform packages (platform selection happens at runtime);
no dependency carrying a `binding.gyp`.

Verify before publish:
```bash
npm pack                 # inspect tarball contents + size
npm publish --dry-run
# After a test install, this must list NOTHING for @aoagents/ao:
npm approve-scripts --allow-scripts-pending
```

### 6.3 File layout

```
packages/launcher
├── package.json
├── bin/ao.js          # CLI entry: dispatch on subcommand
└── src/
    ├── resolve.js     # marker read + stat + location scan
    ├── platform.js    # platform/arch → asset name + URL + bundle name
    ├── fetch.js       # download + unpack/install into place
    ├── open.js        # open the app, or print instructions
    └── notice.js      # terminal deprecation message
```

### 6.4 `ao start` algorithm

```
ao start:
  app = resolve()                 # marker → stat → known-location scan
  if app is null:
      app = fetch()               # download latest for this platform, place it
  opened = open(app)
  printDeprecationNotice()        # terminal message; rich tour (if any) is in-app
  if not opened: printManualOpen(app)
  exit 0
```

`ao start` does not block on, wait for, or supervise the app. Any other
subcommand prints the deprecation notice. Keep it minimal.

### 6.5 Reference: `platform.js` (corrected constants)

```js
import { homedir } from "node:os";

const OWNER = "aoagents";
const REPO  = "agent-orchestrator";   // verified: §1.1

// Verified bundle/exe names (§1.1). Note the SPACE in the macOS bundle.
const APP_BUNDLE = {
  darwin: "Agent Orchestrator.app",
  win32:  "Agent Orchestrator.exe",
  linux:  "agent-orchestrator",
};

// Stable UPLOAD names (our choice; the release step renames forge's emitted
// artifacts to these). Space-free so the constant URL is clean.
function assetName() {
  const key = `${process.platform}-${process.arch}`;
  const map = {
    "darwin-arm64": "agent-orchestrator-darwin-arm64.zip",
    "darwin-x64":   "agent-orchestrator-darwin-x64.zip",
    "win32-x64":    "agent-orchestrator-win32-x64.exe",   // NSIS installer
    "linux-x64":    "agent-orchestrator-linux-x64.deb",   // or .AppImage, see §11
  };
  const name = map[key];
  if (!name) throw new Error(`Unsupported platform: ${key}`);
  return name;
}

export function appBundleName() { return APP_BUNDLE[process.platform]; }

// Direct download URL: 302-redirects to the latest release asset. No API call,
// no rate limit, version-independent. REQUIRES the release to be non-draft (§1.2).
export function latestAssetUrl() {
  return `https://github.com/${OWNER}/${REPO}/releases/latest/download/${assetName()}`;
}

export function knownInstallLocations() {
  const home = homedir();
  switch (process.platform) {
    case "darwin": return ["/Applications", `${home}/Applications`];
    case "win32":  return [`${process.env.LOCALAPPDATA}\\Programs\\agent-orchestrator`, "C:\\Program Files\\Agent Orchestrator"];
    case "linux":  return ["/opt/Agent Orchestrator", "/usr/bin", `${home}/.local/bin`];
    default: return [];
  }
}
```

### 6.6 Platform fetch/open asymmetry (real design point)

The "fetch and open" model is clean only on macOS. The artifacts differ:

- **macOS:** download `.zip` → unpack with **`ditto -x -k`** (preserves the `.app`
  signature; plain `unzip` corrupts it) → `open` the `.app`. App relocates itself.
- **Windows:** the artifact is an **NSIS installer `.exe`** (§1.2), not a runnable
  bundle. `fetch` = download the installer; `open` = run the installer (user
  clicks through, or `/S` silent), then `resolve` finds the installed exe and
  launches it. There is no "unzip a bundle" step.
- **Linux:** `.deb`/`.rpm` need a package install (privileged), or switch the
  Linux artifact to an **AppImage** (single executable, no install). AppImage is
  the better fit for a fetch-and-run launcher (decide at build time, §11).

---

## 7. App-side responsibilities (grounded placement)

### 7.1 Marker write + relocation (new)

Hook into `app.whenReady()` (`main.ts:822`), **before** `createWindow()`, ordering
**relocate → then write marker** so the marker records the post-relocation path:

```ts
app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.isPackaged) {
    // moveToApplicationsFolder() restarts the app on success, so code after it
    // only runs when no relocation happened.
    try { app.moveToApplicationsFolder(); } catch { /* user declined / not movable */ }
  }
  await writeAppStateMarker();   // atomic temp+rename, mirror runfile.Write

  registerRendererProtocol();
  createWindow();
  void startDaemon();
  initAutoUpdates();
  // … existing activate handler …
});
```

`writeAppStateMarker()` records `app.getAppPath()`/`app.getVersion()` into
`~/.ao/app-state.json` using the atomic pattern from
`backend/internal/runfile/runfile.go`. Reuse the `~/.ao` resolution already in the
app (`os.homedir()/.ao`, honoring `AO_DATA_DIR` only if the team decides the
marker belongs under the data dir; default: directly under `~/.ao`).

### 7.2 installSource capture

The bootstrapper passes `--installed-via=npm-bootstrap` when opening. The app
records `installSource` **only** when first creating the marker. Website/GitHub
launches carry no flag and record `website`/`github`/`unknown`. This lets a future
tour tailor its message without the bootstrapper ever writing the marker.

### 7.3 Already done, rely on it

Login-shell env (`shell-env.ts:27`), `userData` pin (`main.ts:64`), and the
supervisor-link lifecycle from #2185 (`main/supervisor-link.ts`,
`main/daemon-owner.ts`) are in place. Do not re-implement.

---

## 8. Release / build wiring (makes the constant URL work)

- **Stable asset names.** Add a release-workflow step that renames each maker's
  emitted artifact (§1.2) to the space-free names in §6.5 before/at upload. Without
  this the constant URL cannot resolve.
- **Finalize the draft.** `publisher-github` creates `draft: true` releases (§1.2);
  `/releases/latest/download/` only resolves for a published release. Either flip
  to `draft: false` or add a CI step that publishes the draft once assets are
  attached. Decide in §11.
- **`.zip` for macOS** (maker-zip) unpacked with `ditto`; do not switch to
  `.tar.gz`.
- **Linux in the matrix.** Add `ubuntu-latest` (tracked upstream as #2191) so
  deb/rpm/AppImage actually build.
- **One tag drives versions** once Track B lands: the `desktop-v*` tag stamps the
  npm `version`, the app `version`, and the daemon ldflags. The npm `version` is
  cosmetic (the bootstrapper ignores it) but kept in lockstep.

---

## 9. Track B prerequisites (NOT in this effort; listed so v1 copy stays honest)

The auto-update updater is already wired (`update-electron-app`, §1.4). It is inert
until **both**:

1. **Real version stamping** — bump `frontend/package.json` off `0.0.0` and inject
   the daemon version via `-ldflags -X …cli.Version=<tag>` in `build-daemon.mjs`.
2. **Signed + notarized macOS builds** — set `CSC_LINK`/`CSC_KEY_PASSWORD` +
   `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` in release CI
   (Squirrel.Mac refuses unsigned updates; Gatekeeper blocks unsigned downloads).

Until both land: v1 deprecation copy must **not** promise auto-update. The
bootstrapper (fetch + open) still works; users just self-update by re-running
`ao start` or downloading from the website.

---

## 10. Acceptance criteria / test matrix

| # | Scenario | Expected |
|---|---|---|
| 1 | Fresh: `npm i -g @aoagents/ao` | Zero `allow-scripts` warning; `npm approve-scripts --allow-scripts-pending` lists nothing for `@aoagents/ao`. |
| 2 | `npm i -g … --ignore-scripts` (v12 sim) | Install succeeds and `ao start` works. |
| 3 | Fresh macOS `ao start` | Fetches latest `.zip`, `ditto`-unpacks, opens `Agent Orchestrator.app`; app relocates to `/Applications`; `~/.ao/app-state.json` written with the `/Applications` path. |
| 4 | Website install first, then `ao start` | Known-location scan finds the app; it opens. No second copy fetched. |
| 5 | App trashed (marker stale), then `ao start` | Marker `stat` misses → scan misses → re-fetch. No dead-end. |
| 6 | App relocated by `moveToApplicationsFolder()` | App rewrites marker path; next `ao start` opens the correct path. No orphan. |
| 7 | Installed-but-old app, `ao start` | Opens the existing app and exits. Does NOT fetch a newer one. |
| 8 | Windows `ao start` | Downloads NSIS `.exe`, runs the installer, then resolves + opens the installed exe. |
| 9 | Linux `ao start` | Fetches the chosen artifact (deb/rpm install or AppImage run) and launches. |
| 10 | Dock launch (not via `ao start`) | Daemon/sessions come up (proves the login-shell env fix, which `ao start`'s enriched shell would mask). |
| 11 | macOS download integrity | (Per §11 decision) verified before open; once signing lands, launches without Gatekeeper "damaged/unidentified" dialog. |

> Note for the test author: `ao start` opens the app through the calling shell's
> enriched env, so a green `ao start` proves nothing about the Dock-launch path
> (minimal launchd env). Always test the Dock path separately (#10).

---

## 11. Open decisions (deferred to build time — decide before the affected task)

These are the four interview questions not yet answered, plus build-wiring forks.
Each blocks only its own task; none blocks the launcher core.

1. **Legacy migration (§6 of the old draft).** The original ~7.6k-star AO shipped
   via npm with a bundled binary + PATH symlink. Do real legacy users need
   cleanup? Options: none in v1 / detect-and-warn / full auto-cleanup. Needs the
   exact legacy symlink + bundle layout if "full."
2. **Signing gate.** Builds are unsigned today (§1.4). Gate the launcher release on
   signed+notarized (mac) / signed (win) builds, or ship against unsigned and
   accept Gatekeeper/SmartScreen warnings, or treat signing as a parallel Track-B
   effort that meets the launcher at release?
3. **First-run tour + `installSource`.** Build the in-app tour now (without the
   auto-update promise), or defer the tour and only capture `installSource` for
   later, or skip both?
4. **Download integrity.** Verify SHA256 against a published checksums file before
   unpack (recommended), or rely on HTTPS + the app signature, or `codesign
   --verify` the unpacked bundle?
5. **Draft release finalization.** Flip `publisher-github` to `draft: false`, or
   add a CI "publish the draft" step? (Required for the constant URL, §8.)
6. **Linux artifact form.** `.deb`/`.rpm` (install) vs **AppImage** (fetch-and-run,
   better fit for the launcher).
7. **Workspace tool.** npm workspaces (default, matches root lockfile) vs a real
   pnpm monorepo (matches frontend + stated intent).
8. **Website URL** for `notice.js` copy.
9. **npm publish CI.** No registry-publish workflow or `NPM_TOKEN` exists; add an
   `ao-v*`-tagged `npm publish --workspace packages/launcher` workflow.

---

## 12. Task breakdown (for AO execution, dependency-ordered batches)

Batch boundaries = a barrier; tasks within a batch are parallel-safe.

**Batch 1 — foundations (parallel):**
- **T1. Workspace + empty package.** Resolve §11.7, wire `packages/launcher`
  (workspace config + `package.json` per §6.2), zero install scripts. Check: a
  trivial `ao --help` runs after `npm i -g` from a packed tarball.
- **T2. App-side marker.** `writeAppStateMarker()` in `main.ts` `app.whenReady`
  (§7.1) using the atomic pattern; `moveToApplicationsFolder()` on macOS. Check: a
  packaged launch writes/updates `~/.ao/app-state.json` with the real bundle path.
- **T3. Release asset rename + draft finalize.** Resolve §11.5; add the rename
  step (§8) so the four stable URLs resolve. Check: a `workflow_dispatch` produces
  a published release whose `releases/latest/download/<stable-name>` 302-resolves.

**Batch 2 — launcher core (after T1):**
- **T4. `resolve.js` + `platform.js`.** Marker read+stat, known-location scan,
  corrected constants (§6.5). Check: resolves a hand-placed app; returns null when
  absent.
- **T5. macOS `fetch.js`/`open.js`.** Download → `ditto` unpack → `open` with
  `--installed-via=npm-bootstrap`; `notice.js`. Check: acceptance #3 on a mac.

**Batch 3 — cross-platform + integrity (after T4/T5, needs T3):**
- **T6. Windows path** (NSIS installer fetch+run+resolve, §6.6).
- **T7. Linux path** (per §11.6 decision).
- **T8. Download integrity** (per §11.4 decision).

**Batch 4 — rollout (after the core works):**
- **T9. Deprecation notice/tour + `installSource`** (per §11.3); npm publish CI
  (§11.9); legacy migration (per §11.1) if in scope.

> Track B (version stamping, signing, making the updater live) is a **separate
> effort**, not in these batches. T-tasks above that touch copy must avoid
> promising auto-update until Track B lands.
