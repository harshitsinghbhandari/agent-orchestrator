#!/usr/bin/env node
"use strict";

// `ao`: open the Agent Orchestrator desktop app. Self-healing: if the bundle is
// missing (e.g. installed with --ignore-scripts, or postinstall deferred the
// download), fetch it first, then launch. The app is the product; this is just
// the launcher.

const { spawn } = require("node:child_process");
const { ensureBundle, appLaunchPath } = require("../lib/bootstrap");

async function main() {
	await ensureBundle();
	const app = appLaunchPath();

	let child;
	if (process.platform === "darwin") {
		// `open` hands the .app to LaunchServices so it runs as a normal GUI app.
		child = spawn("open", [app, ...process.argv.slice(2)], {
			detached: true,
			stdio: "ignore",
		});
	} else {
		// linux: launch the packaged executable directly.
		child = spawn(`${app}/agent-orchestrator`, process.argv.slice(2), {
			detached: true,
			stdio: "ignore",
		});
	}
	child.unref();
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
