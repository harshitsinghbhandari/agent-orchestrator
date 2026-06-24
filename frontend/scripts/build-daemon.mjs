import { rmSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptsDir, "..");
const repoRoot = resolve(frontendRoot, "..");
const backendRoot = join(repoRoot, "backend");
const outDir = join(frontendRoot, "daemon");

// Cross-compile the bundled daemon to match the Electron package target when
// building for another arch/OS (e.g. AO_DAEMON_GOOS=linux AO_DAEMON_GOARCH=arm64
// to produce a linux-arm64 bundle on an x64 runner). Defaults to the build host,
// so normal host builds are unchanged. The daemon is pure-Go (modernc sqlite),
// so CGO is off and cross-compiles cleanly.
const goos = process.env.AO_DAEMON_GOOS || process.platform;
const outPath = join(outDir, goos === "win32" || goos === "windows" ? "ao.exe" : "ao");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const env = { ...process.env, CGO_ENABLED: "0" };
if (process.env.AO_DAEMON_GOARCH) env.GOARCH = process.env.AO_DAEMON_GOARCH;
if (process.env.AO_DAEMON_GOOS) env.GOOS = process.env.AO_DAEMON_GOOS;

const result = spawnSync("go", ["build", "-o", outPath, "./cmd/ao"], {
	cwd: backendRoot,
	stdio: "inherit",
	env,
});

if (result.error) {
	console.error(`failed to start go build: ${result.error.message}`);
	process.exit(1);
}

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
