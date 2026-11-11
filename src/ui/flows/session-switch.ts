import { resolve } from "node:path";
import { shortenPath } from "../../utils/format.ts";
import { confirmDialogSpec, switchSessionLabels, switchSessionTitle } from "../widgets/confirm-dialog.ts";
import { sessionSubject } from "../widgets/dialog-subject.ts";
import type { FlowHost } from "./host.ts";

/** True when entering another session needs explicit consent before pi can abort the current run. */
export function confirmSessionSwitch(host: FlowHost, file: string, run: () => Promise<void>): boolean {
	const current = host.currentSessionFile;
	const destination = resolve(file);
	if ((current && resolve(current) === destination) || host.data.isAgentIdle?.() !== false) return false;
	// 标题栏右侧标的是要进入的会话（TREE 恢复时也是会话，不是节点的角色 / 时间）。
	const row = host.sessionRows().find((session) => resolve(session.file) === destination);
	host.openMenu(
		"confirm",
		confirmDialogSpec({
			title: switchSessionTitle(),
			labels: switchSessionLabels(),
			subject: (row && sessionSubject(row)) || shortenPath(file),
			onConfirm: () => {
				if (host.isDisposed()) return;
				host.closeDialogs();
				void run();
			},
			onCancel: () => host.closeDialogs(),
		}),
	);
	return true;
}
