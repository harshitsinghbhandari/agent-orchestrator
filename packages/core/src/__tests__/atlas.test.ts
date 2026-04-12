import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import {
  atlasExists,
  initAtlas,
  loadAtlasIndex,
  saveAtlasIndex,
  listFlows,
  getFlow,
  getFlowContent,
  getMultipleFlowContents,
  listPending,
  approvePending,
  rejectPending,
  parseFrontmatter,
  slugify,
  getAtlasDir,
  getFlowsDir,
  getPendingDir,
  getAtlasIndexPath,
  ATLAS_DIR,
  FLOWS_DIR,
  PENDING_DIR,
  ATLAS_INDEX_FILE,
} from "../atlas.js";

describe("atlas path utilities", () => {
  it("constructs correct paths", () => {
    const repoPath = "/my/repo";
    expect(getAtlasDir(repoPath)).toBe("/my/repo/code-atlas");
    expect(getFlowsDir(repoPath)).toBe("/my/repo/code-atlas/flows");
    expect(getPendingDir(repoPath)).toBe("/my/repo/code-atlas/.pending");
    expect(getAtlasIndexPath(repoPath)).toBe("/my/repo/code-atlas/atlas.json");
  });

  it("exports directory constants", () => {
    expect(ATLAS_DIR).toBe("code-atlas");
    expect(FLOWS_DIR).toBe("flows");
    expect(PENDING_DIR).toBe(".pending");
    expect(ATLAS_INDEX_FILE).toBe("atlas.json");
  });
});

describe("slugify", () => {
  it("converts title to lowercase slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("Agent Spawning Process")).toBe("agent-spawning-process");
  });

  it("removes special characters", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("Test: Something (Important)")).toBe("test-something-important");
  });

  it("handles multiple spaces and dashes", () => {
    expect(slugify("Hello   World")).toBe("hello-world");
    expect(slugify("Hello---World")).toBe("hello-world");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
    expect(slugify("-Hello World-")).toBe("hello-world");
  });
});

describe("parseFrontmatter", () => {
  it("parses valid frontmatter", () => {
    const content = `---
title: Test Flow
discoveredIn: aa-1
updated: 2026-04-11
relatedFlows:
  - other-flow
---

## Body Content

This is the body.`;

    const { frontmatter, body } = parseFrontmatter(content);

    expect(frontmatter.title).toBe("Test Flow");
    expect(frontmatter.discoveredIn).toBe("aa-1");
    expect(frontmatter.updated).toBe("2026-04-11");
    expect(frontmatter.relatedFlows).toEqual(["other-flow"]);
    expect(body).toContain("## Body Content");
    expect(body).toContain("This is the body.");
  });

  it("parses frontmatter without optional fields", () => {
    const content = `---
title: Minimal Flow
discoveredIn: aa-2
updated: 2026-04-11
---

Body here.`;

    const { frontmatter, body } = parseFrontmatter(content);

    expect(frontmatter.title).toBe("Minimal Flow");
    expect(frontmatter.relatedFlows).toBeUndefined();
    expect(body.trim()).toBe("Body here.");
  });

  it("throws on missing frontmatter", () => {
    const content = "Just content, no frontmatter.";
    expect(() => parseFrontmatter(content)).toThrow("missing YAML frontmatter");
  });

  it("throws on invalid frontmatter structure", () => {
    const content = `---
notTitle: Something
---

Body.`;

    expect(() => parseFrontmatter(content)).toThrow();
  });
});

describe("atlas initialization", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = join(tmpdir(), `ao-atlas-${randomUUID()}`);
    mkdirSync(repoPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("atlasExists returns false when no atlas", () => {
    expect(atlasExists(repoPath)).toBe(false);
  });

  it("initAtlas creates correct folder structure", () => {
    initAtlas(repoPath);

    expect(existsSync(getAtlasDir(repoPath))).toBe(true);
    expect(existsSync(getFlowsDir(repoPath))).toBe(true);
    expect(existsSync(getPendingDir(repoPath))).toBe(true);
    expect(existsSync(getAtlasIndexPath(repoPath))).toBe(true);
    expect(existsSync(join(getPendingDir(repoPath), ".gitkeep"))).toBe(true);
  });

  it("atlasExists returns true after init", () => {
    initAtlas(repoPath);
    expect(atlasExists(repoPath)).toBe(true);
  });

  it("loadAtlasIndex returns empty flows for new atlas", () => {
    initAtlas(repoPath);
    const atlas = loadAtlasIndex(repoPath);

    expect(atlas.flows).toEqual({});
  });

  it("initAtlas is idempotent", () => {
    initAtlas(repoPath);
    initAtlas(repoPath);

    expect(atlasExists(repoPath)).toBe(true);
  });
});

describe("flow management", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = join(tmpdir(), `ao-atlas-${randomUUID()}`);
    mkdirSync(repoPath, { recursive: true });
    initAtlas(repoPath);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("listFlows returns empty array when no flows", () => {
    const flows = listFlows(repoPath);
    expect(flows).toEqual([]);
  });

  it("getFlow returns null for non-existent flow", () => {
    const flow = getFlow(repoPath, "non-existent");
    expect(flow).toBeNull();
  });

  it("getFlowContent returns null for non-existent flow", () => {
    const content = getFlowContent(repoPath, "non-existent");
    expect(content).toBeNull();
  });

  it("getMultipleFlowContents returns empty string for non-existent flows", () => {
    const content = getMultipleFlowContents(repoPath, ["non-existent"]);
    expect(content).toBe("");
  });

  it("getFlow rejects invalid flow IDs", () => {
    expect(() => getFlow(repoPath, "../etc/passwd")).toThrow("Invalid flow ID");
    expect(() => getFlow(repoPath, "..")).toThrow("Invalid flow ID");
    expect(() => getFlow(repoPath, "UPPERCASE")).toThrow("Invalid flow ID");
  });

  it("getFlowContent rejects invalid flow IDs", () => {
    expect(() => getFlowContent(repoPath, "../secret")).toThrow("Invalid flow ID");
    expect(() => getFlowContent(repoPath, "has spaces")).toThrow("Invalid flow ID");
  });

  describe("with existing flows", () => {
    beforeEach(() => {
      // Create a flow file
      const flowContent = `---
title: Agent Spawning
discoveredIn: aa-1
updated: 2026-04-11
---

## How to spawn agents

This is the process for spawning agents.`;

      writeFileSync(join(getFlowsDir(repoPath), "agent-spawning.md"), flowContent);

      // Update the atlas index
      const atlas = loadAtlasIndex(repoPath);
      atlas.flows["agent-spawning"] = {
        id: "agent-spawning",
        title: "Agent Spawning",
        description: "This is the process for spawning agents.",
        lastUpdated: "2026-04-11T00:00:00.000Z",
        sourceAOSession: ["aa-1"],
        successCount: 1,
      };
      saveAtlasIndex(repoPath, atlas);
    });

    it("listFlows returns flow summaries", () => {
      const flows = listFlows(repoPath);

      expect(flows).toHaveLength(1);
      expect(flows[0]?.id).toBe("agent-spawning");
      expect(flows[0]?.title).toBe("Agent Spawning");
      expect(flows[0]?.successCount).toBe(1);
    });

    it("getFlow returns flow with parsed frontmatter", () => {
      const flow = getFlow(repoPath, "agent-spawning");

      expect(flow).not.toBeNull();
      expect(flow?.id).toBe("agent-spawning");
      expect(flow?.frontmatter.title).toBe("Agent Spawning");
      expect(flow?.frontmatter.discoveredIn).toBe("aa-1");
      expect(flow?.body).toContain("## How to spawn agents");
      expect(flow?.metadata.successCount).toBe(1);
    });

    it("getFlowContent returns raw content", () => {
      const content = getFlowContent(repoPath, "agent-spawning");

      expect(content).toContain("---");
      expect(content).toContain("title: Agent Spawning");
      expect(content).toContain("## How to spawn agents");
    });

    it("getMultipleFlowContents combines flows with headers", () => {
      // Add another flow
      const secondContent = `---
title: Error Handling
discoveredIn: aa-2
updated: 2026-04-11
---

## Error handling patterns`;

      writeFileSync(join(getFlowsDir(repoPath), "error-handling.md"), secondContent);

      const atlas = loadAtlasIndex(repoPath);
      atlas.flows["error-handling"] = {
        id: "error-handling",
        title: "Error Handling",
        description: "Error handling patterns",
        lastUpdated: "2026-04-11T00:00:00.000Z",
        sourceAOSession: ["aa-2"],
        successCount: 1,
      };
      saveAtlasIndex(repoPath, atlas);

      const combined = getMultipleFlowContents(repoPath, ["agent-spawning", "error-handling"]);

      expect(combined).toContain("# Flow: agent-spawning");
      expect(combined).toContain("# Flow: error-handling");
      expect(combined).toContain("---");
      expect(combined).toContain("## How to spawn agents");
      expect(combined).toContain("## Error handling patterns");
    });
  });
});

describe("pending flow workflow", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = join(tmpdir(), `ao-atlas-${randomUUID()}`);
    mkdirSync(repoPath, { recursive: true });
    initAtlas(repoPath);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("listPending returns empty array when no pending flows", () => {
    const pending = listPending(repoPath);
    expect(pending).toEqual([]);
  });

  it("listPending returns pending flows", () => {
    const pendingContent = `---
title: New Flow
discoveredIn: aa-3
updated: 2026-04-11
---

## New flow content`;

    writeFileSync(join(getPendingDir(repoPath), "aa-3-new-flow.md"), pendingContent);

    const pending = listPending(repoPath);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe("aa-3-new-flow");
    expect(pending[0]?.frontmatter.title).toBe("New Flow");
    expect(pending[0]?.frontmatter.discoveredIn).toBe("aa-3");
  });

  it("approvePending moves file and updates index", async () => {
    const pendingContent = `---
title: Test Flow
discoveredIn: aa-4
updated: 2026-04-11
---

## Test content`;

    writeFileSync(join(getPendingDir(repoPath), "aa-4-test-flow.md"), pendingContent);

    const flow = await approvePending(repoPath, "aa-4-test-flow");

    // Check returned flow
    expect(flow.id).toBe("test-flow");
    expect(flow.frontmatter.title).toBe("Test Flow");
    expect(flow.metadata.successCount).toBe(1);
    expect(flow.metadata.sourceAOSession).toEqual(["aa-4"]);

    // Check pending file is removed
    expect(existsSync(join(getPendingDir(repoPath), "aa-4-test-flow.md"))).toBe(false);

    // Check flow file exists
    expect(existsSync(join(getFlowsDir(repoPath), "test-flow.md"))).toBe(true);

    // Check atlas index is updated
    const atlas = loadAtlasIndex(repoPath);
    expect(atlas.flows["test-flow"]).toBeDefined();
    expect(atlas.flows["test-flow"]?.title).toBe("Test Flow");
    expect(atlas.flows["test-flow"]?.successCount).toBe(1);
  });

  it("approvePending increments successCount for existing flow", async () => {
    // Create an existing flow
    const existingContent = `---
title: Existing Flow
discoveredIn: aa-1
updated: 2026-04-10
---

## Original content`;

    writeFileSync(join(getFlowsDir(repoPath), "existing-flow.md"), existingContent);

    const atlas = loadAtlasIndex(repoPath);
    atlas.flows["existing-flow"] = {
      id: "existing-flow",
      title: "Existing Flow",
      description: "Original content",
      lastUpdated: "2026-04-10T00:00:00.000Z",
      sourceAOSession: ["aa-1"],
      successCount: 3,
    };
    saveAtlasIndex(repoPath, atlas);

    // Create pending update with same title slug
    const pendingContent = `---
title: Existing Flow
discoveredIn: aa-5
updated: 2026-04-11
---

## Updated content`;

    writeFileSync(join(getPendingDir(repoPath), "aa-5-existing-flow.md"), pendingContent);

    const flow = await approvePending(repoPath, "aa-5-existing-flow");

    expect(flow.metadata.successCount).toBe(4);
    expect(flow.metadata.sourceAOSession).toContain("aa-1");
    expect(flow.metadata.sourceAOSession).toContain("aa-5");
  });

  it("rejectPending deletes pending file", () => {
    const pendingContent = `---
title: Rejected Flow
discoveredIn: aa-6
updated: 2026-04-11
---

## Content to reject`;

    const pendingPath = join(getPendingDir(repoPath), "aa-6-rejected-flow.md");
    writeFileSync(pendingPath, pendingContent);

    expect(existsSync(pendingPath)).toBe(true);

    rejectPending(repoPath, "aa-6-rejected-flow");

    expect(existsSync(pendingPath)).toBe(false);
  });

  it("approvePending throws for non-existent pending", async () => {
    await expect(approvePending(repoPath, "non-existent")).rejects.toThrow("Pending flow not found");
  });

  it("rejectPending throws for non-existent pending", () => {
    expect(() => rejectPending(repoPath, "non-existent")).toThrow("Pending flow not found");
  });

  it("approvePending rejects path traversal attempts", async () => {
    await expect(approvePending(repoPath, "../etc/passwd")).rejects.toThrow("Invalid pending flow ID");
    await expect(approvePending(repoPath, "..")).rejects.toThrow("Invalid pending flow ID");
    await expect(approvePending(repoPath, "foo/bar")).rejects.toThrow("Invalid pending flow ID");
  });

  it("rejectPending rejects path traversal attempts", () => {
    expect(() => rejectPending(repoPath, "../secret")).toThrow("Invalid pending flow ID");
    expect(() => rejectPending(repoPath, "..")).toThrow("Invalid pending flow ID");
  });
});

describe("validation", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = join(tmpdir(), `ao-atlas-${randomUUID()}`);
    mkdirSync(repoPath, { recursive: true });
    initAtlas(repoPath);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("rejects invalid atlas.json", () => {
    writeFileSync(getAtlasIndexPath(repoPath), "not valid json", "utf-8");
    expect(() => loadAtlasIndex(repoPath)).toThrow();
  });

  it("rejects atlas.json with invalid schema", () => {
    writeFileSync(getAtlasIndexPath(repoPath), '{"invalid": "schema"}', "utf-8");
    expect(() => loadAtlasIndex(repoPath)).toThrow();
  });

  it("handles missing flow gracefully", () => {
    // Add metadata but no file
    const atlas = loadAtlasIndex(repoPath);
    atlas.flows["missing-flow"] = {
      id: "missing-flow",
      title: "Missing Flow",
      description: "This flow file does not exist",
      lastUpdated: "2026-04-11T00:00:00.000Z",
      sourceAOSession: ["aa-1"],
      successCount: 1,
    };
    saveAtlasIndex(repoPath, atlas);

    // getFlow should return null when file is missing
    const flow = getFlow(repoPath, "missing-flow");
    expect(flow).toBeNull();
  });

  it("skips invalid pending files", () => {
    // Create an invalid pending file
    writeFileSync(join(getPendingDir(repoPath), "bad-file.md"), "no frontmatter here");

    // Create a valid pending file
    const validContent = `---
title: Valid Flow
discoveredIn: aa-1
updated: 2026-04-11
---

Content`;
    writeFileSync(join(getPendingDir(repoPath), "valid-flow.md"), validContent);

    const pending = listPending(repoPath);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe("valid-flow");
  });
});

describe("YAML escaping", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = join(tmpdir(), `ao-atlas-${randomUUID()}`);
    mkdirSync(repoPath, { recursive: true });
    initAtlas(repoPath);
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("properly escapes special characters in frontmatter", async () => {
    const pendingContent = `---
title: "Flow with: colons and 'quotes'"
discoveredIn: aa-7
updated: 2026-04-11
---

## Content with special chars`;

    writeFileSync(join(getPendingDir(repoPath), "aa-7-special.md"), pendingContent);

    const flow = await approvePending(repoPath, "aa-7-special");

    // Read the saved flow and verify it's valid YAML
    const savedContent = readFileSync(join(getFlowsDir(repoPath), `${flow.id}.md`), "utf-8");
    const { frontmatter } = parseFrontmatter(savedContent);

    expect(frontmatter.title).toBe("Flow with: colons and 'quotes'");
  });
});
