import { useCallback, useState } from "react";

// Shared stage-selection state for the visual editor area: the canvas (V2)
// selects a stage by name, the inspector (V3) binds to it. V3 defined this
// minimal version first (V2 had not landed one yet); V2/Batch-C reconcile on
// this name and shape when the canvas wires node clicks into it. The editor
// area holds one instance and passes selectedStage/selectStage down; names are
// the stable stage identity in the draft model (dependsOn/routes refer by name).
export interface StageSelection {
	selectedStage: string | null;
	selectStage: (name: string | null) => void;
}

export function useStageSelection(): StageSelection {
	const [selectedStage, setSelectedStage] = useState<string | null>(null);
	const selectStage = useCallback((name: string | null) => setSelectedStage(name), []);
	return { selectedStage, selectStage };
}
