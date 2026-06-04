import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunHistoryTimeline } from "../RunHistoryTimeline";

describe("RunHistoryTimeline", () => {
  it("renders an empty hint when there are no prior runs", () => {
    render(<RunHistoryTimeline entries={[]} />);
    expect(screen.getByText("No prior runs.")).toBeInTheDocument();
  });

  it("renders one dot per entry with status accessible labels", () => {
    render(
      <RunHistoryTimeline
        entries={[
          {
            runId: "run-1",
            loopState: "done",
            loopRounds: 1,
            createdAt: "2026-06-04T12:00:00.000Z",
            updatedAt: "2026-06-04T12:01:00.000Z",
          },
          {
            runId: "run-2",
            loopState: "stalled",
            loopRounds: 2,
            createdAt: "2026-06-04T12:02:00.000Z",
            updatedAt: "2026-06-04T12:03:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByLabelText("run run-1 done")).toBeInTheDocument();
    expect(screen.getByLabelText("run run-2 stalled")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
  });
});
