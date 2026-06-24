"use strict";

// Shared bootstrapper logic: detect platform -> map to a GitHub Release asset ->
// download -> verify SHA-256 -> extract -> expose the app path. Used by both the
// postinstall (install.js) and the `ao` launcher (bin/ao.js), so a user who
// installed with --ignore-scripts still gets a working app on first run.
//
// Zero runtime dependencies: Node 20+ global fetch + built-ins only.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const pkg = require("../package.json");
const cfg = pkg.ao;

const packageRoot = path.resolve(__dirname, "..");
const vendorDir = path.join(packageRoot, "vendor");

function platformKey() {
	return `${process.platform}-${process.arch}`;
}

function assetName() {
	return cfg.assets[platformKey()];
}

function releasesPage() {
	return `https://github.com/${cfg.releaseRepo}/releases`;
}

function downloadUrl(name) {
	return `https://github.com/${cfg.releaseRepo}/releases/download/${cfg.releaseTag}/${name}`;
}

// The unpacked app bundle's launch target, per OS. Only darwin ships an asset
// today; linux is mapped for when its archive lands.
function appLaunchPath() {
	if (process.platform === "darwin") {
		return path.join(vendorDir, "Agent Orchestrator.app");
	}
	// linux: maker-zip lays down "Agent Orchestrator-linux-<arch>/" with the
	// executable inside it.
	return path.join(vendorDir, `Agent Orchestrator-linux-${process.arch}`);
}

function isInstalled() {
	return fs.existsSync(appLaunchPath());
}

function unsupportedError() {
	return new Error(
		`Agent Orchestrator has no npm bundle for ${platformKey()}.\n` +
			`Install the desktop app directly instead: ${releasesPage()}`,
	);
}

// Parse a `<sha256>  <filename>` line out of a SHA256SUMS file.
function expectedSha(sumsText, name) {
	for (const line of sumsText.split("\n")) {
		const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
		if (m && path.basename(m[2]) === name) return m[1].toLowerCase();
	}
	return null;
}

async function fetchWithRetry(url, tries = 3) {
	let lastErr;
	for (let i = 0; i < tries; i++) {
		try {
			const res = await fetch(url, { redirect: "follow" });
			if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
			return res;
		} catch (err) {
			lastErr = err;
			// ponytail: linear backoff, fine for a 3-shot install download.
			await new Promise((r) => setTimeout(r, 750 * (i + 1)));
		}
	}
	throw lastErr;
}
// ponytail: no HTTP(S)_PROXY plumbing yet. Add an undici ProxyAgent dispatcher
// here if corp-proxy installs need it; the GitHub CDN is reachable directly for
// the common case.

async function downloadToFile(url, dest) {
	const res = await fetchWithRetry(url);
	await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

function sha256File(file) {
	const hash = crypto.createHash("sha256");
	hash.update(fs.readFileSync(file));
	return hash.digest("hex");
}

function extract(archive, dest) {
	fs.mkdirSync(dest, { recursive: true });
	if (archive.endsWith(".zip")) {
		// ditto preserves the code signature / xattrs of the signed .app better
		// than unzip. Present on every macOS.
		const tool = process.platform === "darwin" ? "ditto" : "unzip";
		const args = tool === "ditto" ? ["-x", "-k", archive, dest] : ["-q", archive, "-d", dest];
		const r = spawnSync(tool, args, { stdio: "inherit" });
		if (r.status !== 0) throw new Error(`extract failed (${tool} exit ${r.status})`);
	} else {
		const r = spawnSync("tar", ["-xzf", archive, "-C", dest], { stdio: "inherit" });
		if (r.status !== 0) throw new Error(`extract failed (tar exit ${r.status})`);
	}
}

// Idempotent: returns the app path, downloading+verifying+extracting only if the
// bundle is not already present. Throws loudly (never half-installs) on any
// unsupported platform, missing asset, or checksum mismatch.
async function ensureBundle({ quiet = false } = {}) {
	if (isInstalled()) return appLaunchPath();

	const name = assetName();
	if (!name) throw unsupportedError();

	const log = quiet ? () => {} : (m) => console.error(m);
	const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ao-dl-"));
	const archive = path.join(tmp, name);

	try {
		log(`Agent Orchestrator: downloading ${name} ...`);
		await downloadToFile(downloadUrl(name), archive);

		log("Agent Orchestrator: verifying checksum ...");
		const sumsRes = await fetchWithRetry(downloadUrl(cfg.checksums));
		const want = expectedSha(await sumsRes.text(), name);
		if (!want) throw new Error(`no ${name} entry in ${cfg.checksums}`);
		const got = sha256File(archive);
		if (got !== want) {
			throw new Error(`checksum mismatch for ${name}\n  expected ${want}\n  got      ${got}`);
		}

		log("Agent Orchestrator: unpacking ...");
		fs.rmSync(vendorDir, { recursive: true, force: true });
		extract(archive, vendorDir);
		if (!isInstalled()) {
			throw new Error(`unpacked archive did not contain the expected app at ${appLaunchPath()}`);
		}
		log("Agent Orchestrator: ready.");
		return appLaunchPath();
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

module.exports = {
	ensureBundle,
	isInstalled,
	appLaunchPath,
	assetName,
	platformKey,
	expectedSha,
	releasesPage,
	unsupportedError,
};
