/**
 * Project-wide constants.
 */

/** Extension identifier used for status/widget keys and log prefixes. */
export const EXTENSION_ID = "lazy-panel";

/** Slash command that opens the panel: `/lazy-history`. */
export const COMMAND_NAME = "lazy-history";

/** Name of the optional user config file inside the pi agent directory. */
export const CONFIG_FILE_NAME = "lazy-panel.json";

/** Layout ratio for the left column (sessions + tree) vs. the right column (content). */
export const LEFT_COLUMN_RATIO = 0.25;

/** Identifiers for the three focusable panes. */
export const PANE_IDS = ["sessions", "tree", "content"] as const;

/**
 * Progress text while pi writes a branch summary for TREE Enter. Shown in the
 * panel footer and, because the panel is hidden meanwhile, in pi's own footer.
 */
export const SUMMARIZING_STATUS = "summarizing branch…";
