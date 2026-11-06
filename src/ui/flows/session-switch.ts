import { resolve } from "node:path";
import { runningSessionSwitchSpec } from "../widgets/confirm-dialog.ts";
import type { FlowHost } from "./host.ts";

/** True when entering another session needs explicit consent before pi can abort the current run. */
export function confirmSessionSwitch(host: FlowHost, file: string, subject: string, run: () => Promise<void>): boolean {
	const current = host.currentSessionFile;
	if ((current && resolve(current) === resolve(file)) || host.data.isAgentIdle?.() !== false) return false;
	host.openMenu("confirm", runningSessionSwitchSpec(
		subject,
		() => {
			if (host.isDisposed()) return;
			host.closeDialogs();
			void run();
		},
		() => host.closeDialogs(),
	));
	return true;
}
