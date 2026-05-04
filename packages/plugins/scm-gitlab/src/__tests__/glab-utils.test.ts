import { describe, it, expect, vi, beforeEach } from "vitest";
import * as childProcess from "node:child_process";

// Mock node:child_process with custom promisify support — promisify(execFile)
// reads the Symbol.for("nodejs.util.promisify.custom") slot, so we install our
// vi.fn() there to intercept the awaited form.
vi.mock("node:child_process", () => {
  const mockExecFile = vi.fn();
  (mockExecFile as any)[Symbol.for("nodejs.util.promisify.custom")] = vi.fn();
  return { execFile: mockExecFile };
});

const mockExecFileCustom = (childProcess.execFile as any)[
  Symbol.for("nodejs.util.promisify.custom")
] as ReturnType<typeof vi.fn>;

import { extractHost, glab, parseJSON, stripHost } from "../glab-utils.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractHost", () => {
  it("returns the host when the path has a dotted prefix and 3+ segments", () => {
    expect(extractHost("gitlab.example.com/group/project")).toBe("gitlab.example.com");
    expect(extractHost("gitlab.example.com/group/sub/project")).toBe("gitlab.example.com");
  });

  it("returns undefined when the first segment has no dot", () => {
    expect(extractHost("group/project")).toBeUndefined();
    expect(extractHost("owner/sub/project")).toBeUndefined();
  });

  it("returns undefined when there are fewer than 3 segments", () => {
    expect(extractHost("gitlab.com/project")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(extractHost("")).toBeUndefined();
  });
});

describe("stripHost", () => {
  it("strips the host prefix when present", () => {
    expect(stripHost("gitlab.example.com/group/project")).toBe("group/project");
    expect(stripHost("gitlab.example.com/group/sub/project")).toBe("group/sub/project");
  });

  it("leaves the path unchanged when no host prefix is detected", () => {
    expect(stripHost("group/project")).toBe("group/project");
    expect(stripHost("group/sub/project")).toBe("group/sub/project");
  });

  it("leaves the path unchanged when fewer than 3 segments", () => {
    expect(stripHost("gitlab.com/project")).toBe("gitlab.com/project");
  });
});

describe("parseJSON", () => {
  it("parses valid JSON to its typed value", () => {
    expect(parseJSON<{ a: number }>('{"a":1}', "ctx")).toEqual({ a: 1 });
    expect(parseJSON<number[]>("[1,2,3]", "ctx")).toEqual([1, 2, 3]);
  });

  it("throws with the context prefix on malformed JSON", () => {
    expect(() => parseJSON("{not json}", "loading repos")).toThrow(/loading repos: expected JSON/);
  });

  it("truncates the invalid payload preview to the first 200 chars", () => {
    // Distinct prefix and suffix so we can verify the cut point precisely.
    const prefix = "a".repeat(200);
    const suffix = "BANNED" + "z".repeat(300);
    let thrown: unknown;
    try {
      parseJSON(prefix + suffix, "ctx");
    } catch (err) {
      thrown = err;
    }
    const msg = (thrown as Error).message;
    expect(msg).toContain(prefix);
    // Source slices to 200 chars — content past the cut must not appear.
    expect(msg).not.toContain("BANNED");
    expect(msg).not.toContain("z".repeat(50));
  });
});

describe("glab", () => {
  it("invokes the glab binary with the given args and returns trimmed stdout", async () => {
    mockExecFileCustom.mockResolvedValueOnce({ stdout: "result\n", stderr: "" });

    const out = await glab(["api", "/projects"]);

    expect(out).toBe("result");
    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "glab",
      ["api", "/projects"],
      { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 },
    );
  });

  it("injects --hostname after 'api' when a hostname is supplied", async () => {
    mockExecFileCustom.mockResolvedValueOnce({ stdout: "ok", stderr: "" });

    await glab(["api", "/projects"], "gitlab.corp.example");

    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "glab",
      ["api", "--hostname", "gitlab.corp.example", "/projects"],
      expect.any(Object),
    );
  });

  it("does not inject --hostname for non-api commands", async () => {
    mockExecFileCustom.mockResolvedValueOnce({ stdout: "ok", stderr: "" });

    await glab(["mr", "list"], "gitlab.corp.example");

    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "glab",
      ["mr", "list"],
      expect.any(Object),
    );
  });

  it("does not inject --hostname when none is supplied", async () => {
    mockExecFileCustom.mockResolvedValueOnce({ stdout: "ok", stderr: "" });

    await glab(["api", "/projects"]);

    const args = mockExecFileCustom.mock.calls[0]![1] as string[];
    expect(args).not.toContain("--hostname");
  });

  it("wraps execFile errors with the failed command summary and preserves cause", async () => {
    const cause = new Error("ENOENT");
    mockExecFileCustom.mockRejectedValueOnce(cause);

    let thrown: unknown;
    try {
      await glab(["api", "/projects", "extra"]);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error & { cause?: unknown };
    expect(err.message).toContain("glab api /projects extra failed");
    expect(err.message).toContain("ENOENT");
    expect(err.cause).toBe(cause);
  });
});
