import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FindingRow, type FindingArtifactView } from "../FindingRow";

const baseFinding: FindingArtifactView = {
  artifactId: "art-1",
  stageRunId: "sr-1",
  status: "open",
  filePath: "src/foo.ts",
  startLine: 10,
  endLine: 12,
  title: "Use const",
  description: "Avoid mutable bindings",
  severity: "warning",
  category: "style",
  confidence: 0.92,
};

describe("FindingRow", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("PATCHes the artifact when Dismiss is clicked", async () => {
    const onChanged = vi.fn();
    render(
      <FindingRow
        runId="run-1"
        projectId="demo"
        finding={baseFinding}
        onStatusChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toMatch(/\/api\/pipelines\/runs\/run-1\/artifacts\/art-1/);
    expect((init as RequestInit | undefined)?.method).toBe("PATCH");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toEqual({ status: "dismissed", stageRunId: "sr-1" });
    expect(onChanged).toHaveBeenCalledWith("dismissed");
  });

  it("shows Reopen instead of Dismiss when already dismissed", () => {
    render(
      <FindingRow
        runId="run-1"
        projectId="demo"
        finding={{ ...baseFinding, status: "dismissed" }}
      />,
    );
    expect(screen.getByText("Reopen")).toBeInTheDocument();
    expect(screen.queryByText("Dismiss")).not.toBeInTheDocument();
  });

  it("surfaces the error returned by the server", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "store write failed" }),
    });
    render(<FindingRow runId="run-1" projectId="demo" finding={baseFinding} />);
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() =>
      expect(screen.getByText(/store write failed/)).toBeInTheDocument(),
    );
  });
});
