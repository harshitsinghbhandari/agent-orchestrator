import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardPR } from "@/lib/types";
import {
  activityStateClass,
  activityToneClass,
  buildGitHubBranchUrl,
  ciToneClass,
  cleanBugbotComment,
  formatTimeCompact,
  getCiShortLabel,
  getReviewShortLabel,
  mobileStatusPillClass,
  sessionActivityMeta,
} from "../session-detail-utils";

function makePR(overrides: Partial<DashboardPR> = {}): DashboardPR {
  return {
    number: 1,
    url: "https://github.com/owner/repo/pull/1",
    title: "Test PR",
    owner: "owner",
    repo: "repo",
    branch: "feature",
    baseBranch: "main",
    isDraft: false,
    state: "open",
    additions: 10,
    deletions: 2,
    ciStatus: "passing",
    ciChecks: [],
    reviewDecision: "approved",
    mergeability: {
      mergeable: true,
      blockers: [],
    },
    unresolvedThreads: 0,
    unresolvedComments: [],
    enriched: true,
    ...overrides,
  };
}

describe("sessionActivityMeta", () => {
  it("covers every public activity state", () => {
    expect(Object.keys(sessionActivityMeta).sort()).toEqual(
      ["active", "blocked", "exited", "idle", "ready", "waiting_input"].sort(),
    );
  });

  it("uses semantic CSS variables for colours", () => {
    for (const meta of Object.values(sessionActivityMeta)) {
      expect(meta.color).toMatch(/^var\(--color-status-/);
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });
});

describe("formatTimeCompact", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for null input", () => {
    expect(formatTimeCompact(null)).toBe("just now");
  });

  it("returns 'just now' for unparseable date", () => {
    expect(formatTimeCompact("not-a-date")).toBe("just now");
  });

  it("returns 'just now' for future timestamps", () => {
    expect(formatTimeCompact("2026-05-04T13:00:00Z")).toBe("just now");
  });

  it("returns 'just now' for sub-minute differences", () => {
    expect(formatTimeCompact("2026-05-04T11:59:30Z")).toBe("just now");
  });

  it("formats minutes (under an hour)", () => {
    expect(formatTimeCompact("2026-05-04T11:45:00Z")).toBe("15m ago");
  });

  it("formats hours (under a day)", () => {
    expect(formatTimeCompact("2026-05-04T09:00:00Z")).toBe("3h ago");
  });

  it("formats days for older dates", () => {
    expect(formatTimeCompact("2026-05-01T12:00:00Z")).toBe("3d ago");
  });
});

describe("getCiShortLabel", () => {
  it("returns 'CI passing' when CI is passing", () => {
    expect(getCiShortLabel(makePR({ ciStatus: "passing" }))).toBe("CI passing");
  });

  it("returns 'CI failed' when CI is failing", () => {
    expect(getCiShortLabel(makePR({ ciStatus: "failing" }))).toBe("CI failed");
  });

  it("returns 'CI pending' for any other status", () => {
    expect(getCiShortLabel(makePR({ ciStatus: "pending" }))).toBe("CI pending");
    expect(getCiShortLabel(makePR({ ciStatus: "none" }))).toBe("CI pending");
  });

  it("collapses to bare 'CI' when PR is rate-limited", () => {
    const pr = makePR({
      mergeability: { mergeable: false, blockers: ["API rate limited or unavailable"] },
    });
    expect(getCiShortLabel(pr)).toBe("CI");
  });

  it("collapses to bare 'CI' when PR is unenriched", () => {
    expect(getCiShortLabel(makePR({ enriched: false }))).toBe("CI");
  });
});

describe("getReviewShortLabel", () => {
  it("returns 'approved' when review decision is approved", () => {
    expect(getReviewShortLabel(makePR({ reviewDecision: "approved" }))).toBe("approved");
  });

  it("returns 'changes' when changes are requested", () => {
    expect(getReviewShortLabel(makePR({ reviewDecision: "changes_requested" }))).toBe("changes");
  });

  it("returns 'review' for any other decision", () => {
    expect(getReviewShortLabel(makePR({ reviewDecision: "pending" }))).toBe("review");
    expect(getReviewShortLabel(makePR({ reviewDecision: "none" }))).toBe("review");
  });

  it("returns empty string when PR is rate-limited or unenriched", () => {
    expect(
      getReviewShortLabel(
        makePR({
          mergeability: { mergeable: false, blockers: ["API rate limited or unavailable"] },
        }),
      ),
    ).toBe("");
    expect(getReviewShortLabel(makePR({ enriched: false }))).toBe("");
  });
});

describe("cleanBugbotComment", () => {
  it("returns title=Comment for a plain comment body", () => {
    const result = cleanBugbotComment("Looks good to me!");
    expect(result).toEqual({ title: "Comment", description: "Looks good to me!" });
  });

  it("trims whitespace from a plain comment body", () => {
    expect(cleanBugbotComment("  hello\n").description).toBe("hello");
  });

  it("extracts title from bugbot-style markdown headings", () => {
    const body = "### **Possible bug**\n<!-- DESCRIPTION START -->\nDetails here.\n<!-- DESCRIPTION END -->";
    const result = cleanBugbotComment(body);
    expect(result.title).toBe("Possible bug");
    expect(result.description).toBe("Details here.");
  });

  it("falls back to the first line when DESCRIPTION block is missing", () => {
    const body = "### Some title\nFirst line of body\nMore lines";
    const result = cleanBugbotComment(body);
    expect(result.title).toBe("Some title");
    expect(result.description).toBe("### Some title");
  });

  it("returns 'Comment' when no markdown heading is present even with description block", () => {
    const body = "<!-- DESCRIPTION START -->\nbugbot body\n<!-- DESCRIPTION END -->";
    const result = cleanBugbotComment(body);
    expect(result.title).toBe("Comment");
    expect(result.description).toBe("bugbot body");
  });

  it("falls back to the first line when description markers are mismatched", () => {
    // Only the START marker is present — descMatch is null, fallback used.
    const body = "### Title\n<!-- DESCRIPTION START -->\nfirst body line\nsecond body line";
    const result = cleanBugbotComment(body);
    expect(result.title).toBe("Title");
    expect(result.description).toBe("### Title");
  });
});

describe("buildGitHubBranchUrl", () => {
  it("uses the PR url's origin so GitHub Enterprise hosts are preserved", () => {
    const pr = makePR({
      url: "https://ghe.corp.example/team/repo/pull/42",
      owner: "team",
      repo: "repo",
      branch: "feature/x",
    });
    expect(buildGitHubBranchUrl(pr)).toBe("https://ghe.corp.example/team/repo/tree/feature/x");
  });

  it("falls back to public github.com when the PR url is invalid", () => {
    const pr = makePR({ url: "not-a-url", branch: "feature" });
    expect(buildGitHubBranchUrl(pr)).toBe("https://github.com/owner/repo/tree/feature");
  });
});

describe("activityStateClass", () => {
  it.each([
    ["active", "session-detail-status-pill--active"],
    ["Active", "session-detail-status-pill--active"],
    ["ready", "session-detail-status-pill--ready"],
    ["idle", "session-detail-status-pill--idle"],
    ["waiting for input", "session-detail-status-pill--waiting"],
    ["blocked", "session-detail-status-pill--error"],
    ["exited", "session-detail-status-pill--error"],
    ["something-else", "session-detail-status-pill--neutral"],
  ])("maps %s to %s", (label, expected) => {
    expect(activityStateClass(label)).toBe(expected);
  });
});

describe("activityToneClass", () => {
  it.each([
    ["var(--color-status-working)", "session-detail-tone--working"],
    ["var(--color-status-ready)", "session-detail-tone--ready"],
    ["var(--color-status-idle)", "session-detail-tone--idle"],
    ["var(--color-status-attention)", "session-detail-tone--attention"],
    ["var(--color-status-error)", "session-detail-tone--error"],
    ["#whatever", "session-detail-tone--muted"],
  ])("maps %s to %s", (color, expected) => {
    expect(activityToneClass(color)).toBe(expected);
  });
});

describe("mobileStatusPillClass", () => {
  it.each([
    ["active", "session-detail__status-pill--active"],
    ["ready", "session-detail__status-pill--ready"],
    ["waiting for input", "session-detail__status-pill--waiting"],
    ["blocked", "session-detail__status-pill--error"],
    ["exited", "session-detail__status-pill--error"],
    ["idle", "session-detail__status-pill--idle"],
    ["something-else", "session-detail__status-pill--idle"],
  ])("maps %s to %s", (label, expected) => {
    expect(mobileStatusPillClass(label)).toBe(expected);
  });
});

describe("ciToneClass", () => {
  it("returns neutral tone when PR is rate-limited", () => {
    const pr = makePR({
      mergeability: { mergeable: false, blockers: ["API rate limited or unavailable"] },
    });
    expect(ciToneClass(pr)).toBe("session-detail-ci-tone--neutral");
  });

  it("returns neutral tone when PR is unenriched", () => {
    expect(ciToneClass(makePR({ enriched: false }))).toBe("session-detail-ci-tone--neutral");
  });

  it.each([
    ["passing", "session-detail-ci-tone--pass"],
    ["failing", "session-detail-ci-tone--fail"],
    ["pending", "session-detail-ci-tone--pending"],
    ["none", "session-detail-ci-tone--pending"],
  ] as const)("maps ciStatus=%s to %s", (status, expected) => {
    expect(ciToneClass(makePR({ ciStatus: status }))).toBe(expected);
  });
});
