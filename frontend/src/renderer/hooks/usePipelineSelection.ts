// Shared "selected stage" state for the pipeline definition editor surfaces.
//
// The canvas (V2) writes on node select/deselect; the stage inspector (V3)
// subscribes via useSelectedStage to know which stage to bind. A module-level
// store (one definition editor is open at a time) instead of a context so the
// canvas and inspector need no common provider; the editor shell or any
// consumer can call clearSelectedStage when the editor closes.
//
// The stored value is the stage NAME (the draft's stable identity and node
// id). Consumers must treat a name that no longer exists in the draft as "no
// selection" (stages can be removed or renamed in YAML mode).

import { useSyncExternalStore } from "react";

let selectedStage: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getSelectedStage(): string | null {
	return selectedStage;
}

export function setSelectedStage(name: string | null): void {
	if (selectedStage === name) return;
	selectedStage = name;
	for (const listener of [...listeners]) listener();
}

export function clearSelectedStage(): void {
	setSelectedStage(null);
}

export function useSelectedStage(): string | null {
	return useSyncExternalStore(subscribe, getSelectedStage);
}
