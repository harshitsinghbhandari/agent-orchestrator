import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PipelineRunCard } from "../PipelineRunCard";
import type { PipelineRunSummary } from "@/hooks/usePipelineEvents";

function makeRun(overrides: Partial<PipelineRunSummary> = {}): PipelineRunSummary {
  return {
    runId: "run-abc",
    pipelineId: "pl-1",
    pipelineName: "code_review",
    sessionId: "app-3",
    projectId: "demo",
    loopState: "running",
    loopRounds: 1,
    headSha: "abc123def456",
    createdAt: "2026-06-04T12:00:00.000Z",
    updatedAt: "2026-06-04T12:01:00.000Z",
    stageCount: 2,
    stageStatuses: { review: "running", router: "pending" },
    hasOpenFindings: false,
    ...overrides,
  };
}

describe("PipelineRunCard", () => {
  it("renders pipeline + session ids and the truncated head sha", () => {
    render(<PipelineRunCard run={makeRun()} />);
    expect(screen.getByText("code_review")).toBeInTheDocument();
    expect(screen.getByText("app-3")).toBeInTheDocument();
    expect(screen.getByText(/abc123def456/)).toBeInTheDocument();
  });

  it("renders per-stage dots labelled by status", () => {
    render(<PipelineRunCard run={makeRun()} />);
    expect(screen.getByLabelText("stage review running")).toBeInTheDocument();
    expect(screen.getByLabelText("stage router pending")).toBeInTheDocument();
  });

  it("expands to reveal a detail link when clicked", () => {
    render(<PipelineRunCard run={makeRun()} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("View run details →")).toBeInTheDocument();
  });

  it("surfaces a hint when the run has open findings", () => {
    render(<PipelineRunCard run={makeRun({ hasOpenFindings: true })} />);
    expect(screen.getByText(/open findings/)).toBeInTheDocument();
  });
});
