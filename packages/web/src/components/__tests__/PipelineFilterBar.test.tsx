import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineFilterBar, type PipelineFilters } from "../PipelineFilterBar";

const baseFilters: PipelineFilters = { pipelineNames: [], showDismissed: false };

describe("PipelineFilterBar", () => {
  it("renders one chip per pipeline name and toggles selection", () => {
    const onChange = vi.fn();
    render(
      <PipelineFilterBar
        filters={baseFilters}
        availablePipelines={["code_review", "lint"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("code_review"));
    expect(onChange).toHaveBeenCalledWith({
      pipelineNames: ["code_review"],
      showDismissed: false,
    });
  });

  it("shows the clear button when filters are active", () => {
    const onChange = vi.fn();
    render(
      <PipelineFilterBar
        filters={{ pipelineNames: ["lint"], showDismissed: false }}
        availablePipelines={["code_review", "lint"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("clear"));
    expect(onChange).toHaveBeenCalledWith({ pipelineNames: [], showDismissed: false });
  });

  it("toggles the show-dismissed checkbox", () => {
    const onChange = vi.fn();
    render(
      <PipelineFilterBar
        filters={baseFilters}
        availablePipelines={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith({ pipelineNames: [], showDismissed: true });
  });
});
