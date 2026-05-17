import {
  DEFAULT_ACTIVE_WINDOW_MS,
  DEFAULT_READY_THRESHOLD_MS,
  type ActivityDetection,
  type ActivityState,
  type SessionId,
} from "./types.js";

export type ActivityReducerLiveness = "active" | "ready" | "idle" | "exited";
export type ActivityReducerInbox = "waiting_input" | "blocked" | null;
export type ActivityReducerSource = "native-stream" | "native-poll" | "terminal" | "process-probe";

export interface ActivityReducerState {
  liveness: ActivityReducerLiveness;
  inbox: ActivityReducerInbox;
  lastEventAt: Date;
  source: ActivityReducerSource;
  eventTimestamp?: Date;
}

export interface ActivityReducerEvent {
  state: ActivityState;
  timestamp?: Date;
  source?: ActivityReducerSource;
}

export type ActivityReducerClearReason = "resolved" | "override" | "exited";
export type ActivityReducerListener = (state: ActivityReducerState) => void;

const reducerStates = new Map<SessionId, ActivityReducerState>();
const listeners = new Map<SessionId, Set<ActivityReducerListener>>();

function cloneState(state: ActivityReducerState): ActivityReducerState {
  return {
    liveness: state.liveness,
    inbox: state.inbox,
    lastEventAt: new Date(state.lastEventAt.getTime()),
    source: state.source,
    eventTimestamp: state.eventTimestamp ? new Date(state.eventTimestamp.getTime()) : undefined,
  };
}

function getOrCreateState(sessionId: SessionId, now: Date = new Date()): ActivityReducerState {
  const existing = reducerStates.get(sessionId);
  if (existing) return existing;

  const created: ActivityReducerState = {
    liveness: "idle",
    inbox: null,
    lastEventAt: now,
    source: "process-probe",
  };
  reducerStates.set(sessionId, created);
  return created;
}

function notifyIfChanged(sessionId: SessionId, before: ActivityReducerState): void {
  const after = reducerStates.get(sessionId);
  if (!after) return;

  if (before.inbox === after.inbox && before.liveness === after.liveness) return;

  const sessionListeners = listeners.get(sessionId);
  if (!sessionListeners) return;

  const eventSnapshot = cloneState(after);
  for (const listener of sessionListeners) {
    listener(eventSnapshot);
  }
}

function ageLiveness(state: ActivityReducerState, now: Date): ActivityReducerLiveness {
  if (state.liveness === "exited" || state.liveness === "idle") return state.liveness;

  const ageMs = Math.max(0, now.getTime() - state.lastEventAt.getTime());
  if (ageMs <= DEFAULT_ACTIVE_WINDOW_MS) return "active";
  if (ageMs <= DEFAULT_READY_THRESHOLD_MS) return "ready";
  return "idle";
}

export function snapshot(sessionId: SessionId): ActivityReducerState | null {
  const state = reducerStates.get(sessionId);
  return state ? cloneState(state) : null;
}

export function applyEvent(
  sessionId: SessionId,
  event: ActivityReducerEvent,
): ActivityReducerState {
  const eventAt = event.timestamp ?? new Date();
  const state = getOrCreateState(sessionId, eventAt);
  const before = cloneState(state);

  state.lastEventAt = eventAt;
  state.eventTimestamp = event.timestamp;
  state.source = event.source ?? "native-poll";

  if (event.state === "waiting_input" || event.state === "blocked") {
    state.inbox = event.state;
    if (state.liveness === "exited") {
      state.liveness = "active";
    }
  } else if (event.state === "exited") {
    state.liveness = "exited";
    state.inbox = null;
    state.eventTimestamp = event.timestamp;
    state.source = event.source ?? "process-probe";
  } else {
    state.liveness = event.state;
  }

  notifyIfChanged(sessionId, before);
  return cloneState(state);
}

export function applyLivenessTick(sessionId: SessionId, now: Date): ActivityReducerState {
  const state = getOrCreateState(sessionId, now);
  const before = cloneState(state);
  state.liveness = ageLiveness(state, now);
  notifyIfChanged(sessionId, before);
  return cloneState(state);
}

export function applyProcessProbe(sessionId: SessionId, alive: boolean): ActivityReducerState {
  const existing = reducerStates.get(sessionId);
  if (alive && !existing) {
    return {
      liveness: "idle",
      inbox: null,
      lastEventAt: new Date(),
      source: "process-probe",
    };
  }
  const state = getOrCreateState(sessionId);
  const before = cloneState(state);

  if (alive) {
    if (state.liveness !== "exited") {
      return cloneState(state);
    }
    state.lastEventAt = new Date();
    state.eventTimestamp = undefined;
    state.source = "process-probe";
    state.liveness = "idle";
  } else {
    state.lastEventAt = new Date();
    state.eventTimestamp = state.lastEventAt;
    state.source = "process-probe";
    state.liveness = "exited";
    state.inbox = null;
  }

  notifyIfChanged(sessionId, before);
  return cloneState(state);
}

export function clearInbox(
  sessionId: SessionId,
  _reason: ActivityReducerClearReason,
): ActivityReducerState {
  const state = getOrCreateState(sessionId);
  const before = cloneState(state);
  state.inbox = null;
  notifyIfChanged(sessionId, before);
  return cloneState(state);
}

export function composeActivity(state: ActivityReducerState | null): ActivityDetection | null {
  if (!state) return null;
  if (state.liveness === "exited") {
    return { state: "exited", timestamp: state.eventTimestamp };
  }
  if (state.inbox) {
    return { state: state.inbox, timestamp: state.eventTimestamp };
  }
  return { state: state.liveness, timestamp: state.eventTimestamp };
}

export function resetActivity(sessionId: SessionId): void {
  reducerStates.delete(sessionId);
}

export function subscribe(sessionId: SessionId, listener: ActivityReducerListener): () => void {
  const sessionListeners = listeners.get(sessionId) ?? new Set<ActivityReducerListener>();
  sessionListeners.add(listener);
  listeners.set(sessionId, sessionListeners);

  return () => {
    const currentListeners = listeners.get(sessionId);
    if (!currentListeners) return;
    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      listeners.delete(sessionId);
    }
  };
}
