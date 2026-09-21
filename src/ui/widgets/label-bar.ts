/**
 * Label bar — bottom-line input for labelling a tree node (`T`, same as
 * `Shift+T` in pi's `/tree`):
 *
 *   Label: checkpoint▏                 Enter save  Esc cancel  empty removes
 *
 * Pre-filled with the node's current label; submitting an empty value clears
 * it. The panel owns the target node and persists the change through the
 * injected actions, this widget only collects the text.
 */

import { PromptBar, type PromptBarOptions } from "./prompt-bar.ts";

/** Text in front of the input. */
export const LABEL_PROMPT = "Label: ";

export type LabelBarOptions = Omit<PromptBarOptions, "label" | "hints">;

export class LabelBar extends PromptBar {
	constructor(o: LabelBarOptions) {
		super({
			...o,
			label: LABEL_PROMPT,
			hints: [
				["Enter", "save"],
				["Esc", "cancel"],
				["empty", "removes"],
			],
		});
	}
}
