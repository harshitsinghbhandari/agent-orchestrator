import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "../ChatPanel";

describe("ChatPanel", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows "chat unavailable" when the agent has no follow-up support', () => {
    render(
      <ChatPanel
        runId="run-1"
        stageRunId="sr-1"
        stageName="review"
        projectId="demo"
        followUpAvailable={false}
        stageActive={true}
      />,
    );
    expect(screen.getByText(/Chat unavailable/i)).toBeInTheDocument();
  });

  it("posts a follow-up message when the user clicks Send", async () => {
    render(
      <ChatPanel
        runId="run-1"
        stageRunId="sr-1"
        stageName="review"
        projectId="demo"
        followUpAvailable={true}
        stageActive={true}
        reviewerId="app-rev-1"
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "please continue" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/thread\?project=demo/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("surfaces a 410 ReviewerWorkspaceGone error inline", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({ error: "gone", code: "ReviewerWorkspaceGone" }),
    });
    render(
      <ChatPanel
        runId="run-1"
        stageRunId="sr-1"
        stageName="review"
        projectId="demo"
        followUpAvailable={true}
        stageActive={true}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() =>
      expect(screen.getByText(/Worker workspace gone/i)).toBeInTheDocument(),
    );
  });
});
