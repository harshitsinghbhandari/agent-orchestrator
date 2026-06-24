"use strict";

// postinstall: fetch the platform bundle eagerly so the first `ao` is instant.
// On an unsupported platform we fail loudly and non-zero (no silent half-install);
// on a transient download failure we DON'T fail the npm install, because the `ao`
// launcher will retry the fetch on first run (this also covers --ignore-scripts).

const { ensureBundle, unsupportedError, assetName } = require("./lib/bootstrap");

async function main() {
	if (!assetName()) {
		console.error(String(unsupportedError().message));
		process.exit(1);
	}
	try {
		await ensureBundle();
	} catch (err) {
		console.error(`Agent Orchestrator: deferred download to first run (${err.message})`);
		// Non-fatal: bin/ao.js will fetch on first launch.
	}
}

main();
