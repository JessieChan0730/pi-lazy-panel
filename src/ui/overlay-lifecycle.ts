import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";

/** Bind only after pi has mounted the full-screen overlay (`onHandle`). */
export function mountPanelOverlay(
	tui: Pick<TUI, "mode" | "requestRender">,
	handle: Pick<OverlayHandle, "setHidden">,
): (hidden: boolean) => void {
	let hidden = false;
	// regular 模式偶发视口错位：显示边界重置差分状态，不在普通滚动时反复清屏。
	function redraw(): void {
		if (tui.mode === "regular") tui.requestRender(true);
	}
	redraw();
	return (nextHidden) => {
		handle.setHidden(nextHidden);
		const showing = hidden && !nextHidden;
		hidden = nextHidden;
		if (showing) redraw();
	};
}
