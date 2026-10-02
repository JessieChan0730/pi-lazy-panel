/** Stable comparison key; do not resolve symlinks or require the session to exist. */
import { resolve } from "node:path";

export function sessionFileKey(file: string): string {
	const absolute = resolve(file);
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}
