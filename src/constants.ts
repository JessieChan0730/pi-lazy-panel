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
 * Key scope of the full tree dialog (`a` in the tree pane). Its bindings sit on
 * top of the tree pane's, which sit on top of the global ones.
 *
 * 树对话框自己的键位 scope：对话框里先查这一层，再查 tree 面板，最后 global。
 */
export const TREE_DIALOG_SCOPE = "tree-dialog" as const;

/** Every key scope of the keymap, in the order the user file lists them. */
export const KEY_SCOPES = ["global", ...PANE_IDS, TREE_DIALOG_SCOPE] as const;

/**
 * Progress text while pi writes a branch summary for TREE Enter. Shown in the
 * panel footer and, because the panel is hidden meanwhile, in pi's own footer.
 */
export const SUMMARIZING_STATUS = "summarizing branch…";
