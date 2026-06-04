import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineWorkbench } from "../PipelineWorkbench";
import type { PipelineRunSummary } from "@/hooks/usePipelineEvents";

vi.mock("@/hooks/usePipelineEvents", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/usePipelineEvents")>(
    "@/hooks/usePipelineEvents",
  );
  return {
    ...actual,
    usePipelineEvents: () => ({ runs: [], loadError: null, lastSnapshotAt: null }),
  };
});

function run(state: PipelineRunSummary["loopState"], runId: string): PipelineRunSummary {
  return {
    runId,
    pipelineId: "pl-1",
    pipelineName: "code_review",
    sessionId: "app-1",
    projectId: "demo",
    loopState: state,
    loopRounds: 1,
    headSha: "abc",
    createdAt: "2026-06-04T12:00:00.000Z",
    updatedAt: "2026-06-04T12:01:00.000Z",
    stageCount: 1,
    stageStatuses: { review: "succeeded" },
    hasOpenFindings: false,
  };
}

describe("PipelineWorkbench", () => {
  it("renders one column per loopState with the right run distribution", () => {
    render(
      <PipelineWorkbench
        initialRuns={[
          run("running", "r1"),
          run("awaiting_context", "r2"),
          run("done", "r3"),
          run("stalled", "r4"),
          run("terminated", "r5"),
          run("running", "r6"),
        ]}
        projectFilter={null}
      />,
    );
    expect(screen.getByRole("region", { name: /Running column/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Awaiting context column/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Done column/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Stalled column/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Terminated column/i })).toBeInTheDocument();
  });

  it("shows an empty hint in columns with no runs", () => {
    render(<PipelineWorkbench initialRuns={[]} projectFilter={null} />);
    expect(screen.getAllByText("Empty").length).toBeGreaterThan(0);
  });
});
