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
 * Sort orders of the sessions pane in the order `s` cycles through them:
 * recent (last update) → created → title (by the title the pane shows — name,
 * else first-message preview — A–Z, empty sessions last) → threaded (forks
 * indented under their parent, like pi's /resume). pi's "fuzzy" order only
 * means something with a search query, so it is not offered here.
 */
export const SESSION_SORT_MODES = ["recent", "created", "title", "threaded"] as const;

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
 * Spinner frames for footer progress — a rotating square (正方形旋转). Kept here
 * so slow operations (branch summary, compaction, the changelog dialog) share
 * the same look. The progress text itself is localised via i18n (status.*).
 */
export const SPINNER_FRAMES = ["◰", "◳", "◲", "◱"] as const;

/** How fast the footer spinner advances one frame. */
export const SPINNER_INTERVAL_MS = 120;
