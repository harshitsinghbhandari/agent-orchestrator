"use strict";

// Minimal runnable check for the non-trivial bits: the SHA256SUMS parser and the
// platform->asset mapping. No framework. Run with `npm test`.

const assert = require("node:assert");
const { expectedSha, assetName, platformKey } = require("../lib/bootstrap");

// SHA256SUMS parsing: matches by basename, tolerates the `*` binary marker and
// path prefixes, ignores unrelated lines.
const sums = [
	"# comment line",
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  agent-orchestrator-darwin-arm64.zip",
	"da39a3ee5e6b4b0d3255bfef95601890afd80709 *some/other-file.tar.gz",
].join("\n");

assert.strictEqual(
	expectedSha(sums, "agent-orchestrator-darwin-arm64.zip"),
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	"should parse the matching checksum by basename",
);
assert.strictEqual(expectedSha(sums, "not-present.zip"), null, "missing asset -> null");

// Platform mapping: on this darwin-arm64 box we expect a real asset; the lookup
// itself must never throw.
assert.doesNotThrow(() => platformKey());
if (platformKey() === "darwin-arm64") {
	assert.strictEqual(assetName(), "agent-orchestrator-darwin-arm64.zip");
}

console.log("selfcheck: ok");
