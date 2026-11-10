import { resolve } from "node:path";
import { shortenPath } from "../../utils/format.ts";
import { runningSessionSwitchSpec } from "../widgets/confirm-dialog.ts";
import { sessionSubject } from "../widgets/dialog-subject.ts";
import type { FlowHost } from "./host.ts";

/** True when entering another session needs explicit consent before pi can abort the current run. */
export function confirmSessionSwitch(host: FlowHost, file: string, run: () => Promise<void>): boolean {
	const current = host.currentSessionFile;
	const destination = resolve(file);
	if ((current && resolve(current) === destination) || host.data.isAgentIdle?.() !== false) return false;
	// TREE 原先传的是节点角色 / 时间；切换确认需要标明实际进入的会话。
	const row = host.sessionRows().find((session) => resolve(session.file) === destination);
	const subject = (row && sessionSubject(row)) || shortenPath(file);
	host.openConfirm("confirm", runningSessionSwitchSpec(
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
