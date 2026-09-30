/** Five-row filter picker for TREE `f`, using the shared centered menu. */

import { t } from "../../i18n/index.ts";
import type { TreeFilter } from "../../types.ts";
import type { SelectDialogSpec } from "./select-dialog.ts";

export function treeFilterDialogSpec(
	current: TreeFilter,
	onSelect: (filter: TreeFilter) => void,
	onCancel: () => void,
): SelectDialogSpec {
	const choices: Array<{ key: string; filter: TreeFilter; label: string }> = [
		{ key: "d", filter: "default", label: t("dialog.treeFilterDefault") },
		{ key: "t", filter: "no-tools", label: t("dialog.treeFilterNoTools") },
		{ key: "u", filter: "user-only", label: t("dialog.treeFilterUser") },
		{ key: "l", filter: "labeled", label: t("dialog.treeFilterLabeled") },
		{ key: "a", filter: "all", label: t("dialog.treeFilterAll") },
	];
	return {
		title: t("dialog.treeFilterTitle"),
		items: choices.map(({ key, label }) => `${key}  ${label}`),
		initialIndex: choices.findIndex(({ filter }) => filter === current),
		shortcuts: Object.fromEntries(choices.map(({ key }, i) => [key, i])),
		hints: [
			["d/t/u/l/a", t("hint.select")],
			["j/k/↑/↓", t("hint.move")],
			["Enter", t("hint.select")],
			["Esc", t("hint.cancel")],
		],
		onSelect: (i) => {
			const choice = choices[i];
			if (choice) onSelect(choice.filter);
		},
		onCancel,
	};
}
