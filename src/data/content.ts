/**
 * Content data adapter.
 *
 * Produces the `ContentBlock[]` shown in the right-hand pane for a session
 * (or a branch ending at a given tree node), distinguishing user vs assistant
 * messages so they can be rendered in separate boxes.
 *
 * TODO: implement loadContent(), loadSessionInfo().
 */

import type { ContentBlock, SessionInfo } from "../types.ts";

export interface LoadContentOptions {
	sessionFile: string;
	/** If set, show the branch that ends at this entry instead of the active leaf. */
	leafEntryId?: string;
}

export async function loadContent(_options: LoadContentOptions): Promise<ContentBlock[]> {
	// TODO: getBranch(leafId) -> user/assistant message entries -> ContentBlock[]
	return [];
}

/** Gather the data shown by the Session Info dialog (mirrors /session). */
export async function loadSessionInfo(_sessionFile: string): Promise<SessionInfo | undefined> {
	// TODO
	return undefined;
}
