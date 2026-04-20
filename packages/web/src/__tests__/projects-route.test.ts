import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { deriveStorageKey, loadGlobalConfig } from "@aoagents/ao-core";

const invalidatePortfolioServicesCache = vi.fn();

vi.mock("@/lib/services", () => ({
  invalidatePortfolioServicesCache,
}));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/projects", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/projects", () => {
  let oldGlobalConfig: string | undefined;
  let tempRoot: string;
  let configPath: string;

  beforeEach(() => {
    vi.resetModules();
    invalidatePortfolioServicesCache.mockReset();
    oldGlobalConfig = process.env["AO_GLOBAL_CONFIG"];
    tempRoot = mkdtempSync(path.join(tmpdir(), "ao-projects-route-"));
    configPath = path.join(tempRoot, "config.yaml");
    process.env["AO_GLOBAL_CONFIG"] = configPath;
  });

  afterEach(() => {
    if (oldGlobalConfig === undefined) {
      delete process.env["AO_GLOBAL_CONFIG"];
    } else {
      process.env["AO_GLOBAL_CONFIG"] = oldGlobalConfig;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("stores the Phase 1a-derived storage key and invalidates services cache", async () => {
    const repoDir = path.join(tempRoot, "demo");
    mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    writeFileSync(
      path.join(repoDir, ".git", "config"),
      '[remote "origin"]\n  url = git@github.com:acme/demo.git\n',
    );

    const { POST } = await import("@/app/api/projects/route");
    const response = await POST(
      makeRequest({ projectId: "demo", name: "Demo", path: repoDir }),
    );

    expect(response.status).toBe(201);
    expect(invalidatePortfolioServicesCache).toHaveBeenCalledTimes(1);

    expect(readFileSync(configPath, "utf-8").length).toBeGreaterThan(0);
    const saved = loadGlobalConfig(configPath);
    expect(saved?.projects.demo?.storageKey).toBe(
      deriveStorageKey({
        originUrl: "https://github.com/acme/demo",
        gitRoot: repoDir,
        projectPath: repoDir,
      }),
    );
  });

  it("returns 409 with collision metadata when another project owns the storage key", async () => {
    const repoDir = path.join(tempRoot, "demo");
    const aliasDir = path.join(tempRoot, "demo-alias");
    mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    writeFileSync(
      path.join(repoDir, ".git", "config"),
      '[remote "origin"]\n  url = git@github.com:acme/demo.git\n',
    );
    symlinkSync(repoDir, aliasDir);

    const { POST } = await import("@/app/api/projects/route");
    await POST(makeRequest({ projectId: "existing-app", name: "Existing", path: repoDir }));

    const response = await POST(
      makeRequest({ projectId: "second-app", name: "Second", path: aliasDir }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      existingProjectId: "existing-app",
      suggestion: "register-as-second",
    });
  });
});
