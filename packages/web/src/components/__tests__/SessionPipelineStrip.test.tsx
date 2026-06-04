import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionPipelineStrip } from "../SessionPipelineStrip";

describe("SessionPipelineStrip", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        runs: [
          {
            runId: "run-1",
            pipelineId: "pl",
            pipelineName: "code_review",
            sessionId: "app-1",
            projectId: "demo",
            loopState: "running",
            loopRounds: 1,
            headSha: "abc",
            createdAt: "2026-06-04T12:00:00.000Z",
            updatedAt: "2026-06-04T12:01:00.000Z",
            stageCount: 2,
            stageStatuses: { review: "running", router: "pending" },
            hasOpenFindings: false,
          },
        ],
      }),
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders status dots for linked pipeline runs", async () => {
    render(<SessionPipelineStrip sessionId="app-1" projectId="demo" />);
    await waitFor(() =>
      expect(screen.getByLabelText("stage review running")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("stage router pending")).toBeInTheDocument();
    expect(screen.getByText("code_review")).toBeInTheDocument();
  });

  it("renders nothing when the session has no pipeline runs", () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [] }),
    });
    const { container } = render(<SessionPipelineStrip sessionId="app-2" projectId="demo" />);
    expect(container.querySelector("[data-testid='session-pipeline-strip']")).toBeNull();
  });
});
