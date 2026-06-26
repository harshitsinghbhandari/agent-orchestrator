import { DashboardSubhead } from "./DashboardSubhead";

// App-wide settings, shown from the sidebar when no project is selected. The
// body is intentionally empty for now; it will be filled in incrementally.
export function GlobalSettingsForm() {
	return (
		<div className="flex h-full min-h-0 flex-col bg-background text-foreground">
			<DashboardSubhead title="Global settings" subtitle="Settings that apply across all projects" />
			<div className="min-h-0 flex-1 overflow-y-auto p-[18px]" />
		</div>
	);
}
