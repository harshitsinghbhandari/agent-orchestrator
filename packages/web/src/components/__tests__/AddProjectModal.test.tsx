import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddProjectModal } from "@/components/AddProjectModal";

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

describe("AddProjectModal", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockRefresh.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the hardened filesystem browse endpoint from the directory picker", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entries: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AddProjectModal open onClose={vi.fn()} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/filesystem/browse?path=~"),
    );
  });

  it("shows a helpful message and disables submit when filesystem browsing is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AddProjectModal open onClose={vi.fn()} />);

    expect(
      await screen.findByText(/directory browsing is unavailable in this environment/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add project$/i })).toBeDisabled();
  });

  it("renders both collision actions when the server returns 409", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [{ name: "second-app", isDirectory: true, isGitRepo: true, hasLocalConfig: false }],
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entries: [{ name: "second-app", isDirectory: true, isGitRepo: true, hasLocalConfig: false }],
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'Project "existing-app" already owns this storage key.',
        existingProjectId: "existing-app",
        suggestion: "open-existing",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AddProjectModal open onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /second-app/i }));
    fireEvent.click(screen.getByRole("button", { name: /^add project$/i }));

    expect(
      await screen.findByRole("button", { name: /open existing/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register as second/i })).toBeInTheDocument();
  });

  it("pushes directly to the new project after a successful POST", async () => {
    const onClose = vi.fn();
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entries: [{ name: "my-app", isDirectory: true, isGitRepo: true, hasLocalConfig: false }],
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, projectId: "my-app" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AddProjectModal open onClose={onClose} />);

    fireEvent.click(await screen.findByRole("button", { name: /my-app/i }));
    fireEvent.click(screen.getByRole("button", { name: /^add project$/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/projects/my-app"));
    expect(onClose).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });
});
