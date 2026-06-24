# Agent Orchestrator (npm bootstrapper)

Install the Agent Orchestrator desktop app from npm:

```bash
npm i -g @theharshitsingh/ao
ao
```

`npm i -g` installs a small **bootstrapper**, not the app itself. On install it
downloads the signed desktop bundle for your platform from the matching GitHub
Release, verifies its SHA-256, and unpacks it. Running `ao` launches the app.

This is a one-time delivery channel. Once the app is installed it updates itself
through its built-in updater. `npm update` is **not** the update path.

## Supported platforms

This build ships macOS `darwin-arm64` (Apple Silicon) and `darwin-x64` (Intel),
both signed + notarized, plus Linux `linux-x64` and `linux-arm64` portable bundles
(checksum-verified; Linux has no Apple-style notarization). Other platforms,
including Windows, fail the install with a pointer to the
[Releases page](https://github.com/harshitsinghbhandari/agent-orchestrator/releases),
where direct installers (`.dmg` / `.deb` / `.exe`) live.

## `--ignore-scripts`

If you install with `npm install --ignore-scripts`, the postinstall download is
skipped; the first `ao` run downloads the bundle instead. Either way it works.
