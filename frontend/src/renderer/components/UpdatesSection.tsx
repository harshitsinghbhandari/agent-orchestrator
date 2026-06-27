import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { aoBridge } from "../lib/bridge";
import type { UpdateChannel, UpdateSettings } from "../../main/update-settings";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export const updateSettingsQueryKey = ["update-settings"] as const;

const CHANNEL_OPTIONS: { value: UpdateChannel; label: string }[] = [
	{ value: "latest", label: "Stable (latest release)" },
	{ value: "nightly", label: "Nightly (pre-release)" },
];

// UpdatesSection is the Global Settings card for the desktop auto-update channel
// (issue #2207). It reads/writes ~/.ao/update-settings.json via the main process
// (the same file auto-updater.ts consumes), letting a user pick Stable vs Nightly.
// Changes apply on the next launch / update check.
export function UpdatesSection() {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: updateSettingsQueryKey,
		queryFn: () => aoBridge.updateSettings.get(),
	});

	const [form, setForm] = useState<UpdateSettings>({ enabled: false, channel: "latest", nightlyAck: false });
	const [savedAt, setSavedAt] = useState<number | null>(null);

	// Seed the form once settings load (and on refetch). Keying off the loaded
	// value keeps local edits responsive without a controlled-from-query loop.
	useEffect(() => {
		if (query.data) setForm(query.data);
	}, [query.data]);

	const save = useMutation({
		mutationFn: async (next: UpdateSettings) => {
			await aoBridge.updateSettings.set(next);
		},
		onSuccess: () => {
			setSavedAt(Date.now());
			void queryClient.invalidateQueries({ queryKey: updateSettingsQueryKey });
		},
	});

	const setEnabled = (enabled: boolean) => {
		setSavedAt(null);
		setForm((f) => ({ ...f, enabled }));
	};
	const setChannel = (channel: UpdateChannel) => {
		setSavedAt(null);
		// Selecting Nightly in Settings is itself the acknowledgement of the
		// instability warning shown below; Stable clears it.
		setForm((f) => ({ ...f, channel, nightlyAck: channel === "nightly" }));
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-[13px]">Updates</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="updatesEnabled" className="text-[12px] text-muted-foreground">
						Automatic updates
					</Label>
					<EnabledSelect id="updatesEnabled" value={form.enabled} onChange={setEnabled} />
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="updateChannel" className="text-[12px] text-muted-foreground">
						Update channel
					</Label>
					<Select value={form.channel} onValueChange={(v) => setChannel(v as UpdateChannel)} disabled={!form.enabled}>
						<SelectTrigger id="updateChannel" className="h-8 w-full text-[13px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CHANNEL_OPTIONS.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{form.channel === "nightly" && form.enabled && (
					<p className="text-[12px] leading-5 text-warning">
						Nightly builds are cut every day and can be unstable or lose data. Only use Nightly if you are comfortable
						with that.
					</p>
				)}

				<div className="flex items-center gap-3">
					<Button type="button" variant="primary" onClick={() => save.mutate(form)} disabled={save.isPending}>
						{save.isPending ? "Saving…" : "Save changes"}
					</Button>
					{save.isError && (
						<span className="text-[12px] text-error">
							{save.error instanceof Error ? save.error.message : "Save failed"}
						</span>
					)}
					{savedAt && !save.isPending && !save.isError && <span className="text-[12px] text-success">Saved.</span>}
				</div>
			</CardContent>
		</Card>
	);
}

function EnabledSelect({ id, value, onChange }: { id: string; value: boolean; onChange: (value: boolean) => void }) {
	return (
		<Select value={value ? "on" : "off"} onValueChange={(v) => onChange(v === "on")}>
			<SelectTrigger id={id} className="h-8 w-full text-[13px]">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="on">Enabled</SelectItem>
				<SelectItem value="off">Disabled</SelectItem>
			</SelectContent>
		</Select>
	);
}
