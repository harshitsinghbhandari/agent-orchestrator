#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/* global process, require */
// AO Codex activity updater. Maps Codex hook payloads to .ao/activity.jsonl.
// Does not persist raw hook payloads.

const fs = require("node:fs");
const path = require("node:path");

const raw = (() => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
})();

const input = (() => {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
})();

const event = typeof input.hook_event_name === "string" ? input.hook_event_name : "unknown";
const tool = typeof input.tool_name === "string" ? input.tool_name : null;
const aoSessionId =
  typeof process.env.AO_SESSION_ID === "string" ? process.env.AO_SESSION_ID.trim() : "";
const hookActivityDisabled = process.env.AO_CODEX_HOOK_ACTIVITY === "0";

if (hookActivityDisabled || aoSessionId.length === 0) {
  process.stdout.write("{}\n");
  process.exit(0);
}

let state = null;
if (event === "PermissionRequest") state = "waiting_input";
else if (event === "Stop") state = "ready";
else if (
  [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "SubagentStart",
    "PreCompact",
    "PostCompact",
  ].includes(event)
)
  state = "active";

if (state !== null) {
  const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
  const workspacePath = process.env.AO_WORKSPACE_PATH || cwd;
  const trigger = tool ? event + ":" + tool : event;
  const entry = {
    ts: new Date().toISOString(),
    state,
    source: "hook",
    trigger,
    sessionId: aoSessionId,
  };
  try {
    const dir = path.join(workspacePath, ".ao");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "activity.jsonl"), JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Activity hooks must never block Codex.
  }
}

process.stdout.write("{}\n");
