/** Local dialog help: wrap whole key/label pairs instead of hiding trailing shortcuts. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { KeyHint } from "../../types.ts";

export function renderDialogHints(hints: KeyHint[], theme: Theme, width: number, maxRows = Infinity): string[] {
	const budget = Math.max(1, width - 2);
	const rows: string[] = [];
	let line = "";
	for (const [key, label] of hints) {
		const part = truncateToWidth(`${theme.bold(theme.fg("accent", key))} ${theme.fg("muted", label)}`, budget, "…", false);
		if (line && visibleWidth(line) + 3 + visibleWidth(part) > budget) {
			rows.push(` ${line}`);
			line = "";
		}
		line = line ? `${line}   ${part}` : part;
	}
	if (line) rows.push(` ${line}`);
	return rows.slice(0, maxRows);
}
