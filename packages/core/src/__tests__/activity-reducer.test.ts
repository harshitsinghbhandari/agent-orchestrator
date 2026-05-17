import { describe, expect, it, vi } from "vitest";
import {
  applyEvent,
  applyLivenessTick,
  applyProcessProbe,
  composeActivity,
  snapshot,
  subscribe,
} from "../activity-reducer.js";

const sessionId = (name: string) => `activity-reducer-${name}`;

describe("activity-reducer", () => {
  it("stores waiting_input as sticky inbox", () => {
    applyEvent(sessionId("waiting-input"), { state: "waiting_input" });

    expect(snapshot(sessionId("waiting-input"))?.inbox).toBe("waiting_input");
  });

  it("keeps inbox sticky when active liveness arrives", () => {
    const id = sessionId("sticky-active");
    applyEvent(id, { state: "waiting_input" });
    applyEvent(id, { state: "active" });

    expect(snapshot(id)?.inbox).toBe("waiting_input");
    expect(snapshot(id)?.liveness).toBe("active");
  });

  it("clears inbox and marks liveness exited when process probe reports dead", () => {
    const id = sessionId("process-dead");
    applyEvent(id, { state: "waiting_input" });

    applyProcessProbe(id, false);

    expect(snapshot(id)?.inbox).toBeNull();
    expect(snapshot(id)?.liveness).toBe("exited");
  });

  it("composes activity with exited over inbox over liveness precedence", () => {
    const inboxId = sessionId("compose-inbox");
    applyEvent(inboxId, { state: "waiting_input" });
    applyEvent(inboxId, { state: "active" });

    expect(composeActivity(snapshot(inboxId))?.state).toBe("waiting_input");

    const exitedId = sessionId("compose-exited");
    applyEvent(exitedId, { state: "waiting_input" });
    applyProcessProbe(exitedId, false);

    expect(composeActivity(snapshot(exitedId))?.state).toBe("exited");

    const liveId = sessionId("compose-liveness");
    applyEvent(liveId, { state: "ready" });

    expect(composeActivity(snapshot(liveId))?.state).toBe("ready");
  });

  it("notifies subscribers on inbox change and liveness class change", () => {
    const id = sessionId("subscribe");
    const listener = vi.fn();
    const unsubscribe = subscribe(id, listener);

    applyEvent(id, { state: "waiting_input" });
    applyEvent(id, { state: "active", timestamp: new Date("2026-01-01T00:00:00.000Z") });
    applyLivenessTick(id, new Date("2026-01-01T00:00:31.000Z"));

    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[0]?.[0].inbox).toBe("waiting_input");
    expect(listener.mock.calls[1]?.[0].liveness).toBe("active");
    expect(listener.mock.calls[2]?.[0].liveness).toBe("ready");
  });
});
