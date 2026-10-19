/** Types for the pure helpers extracted from the i18n scan (see i18n-usage.mjs). */

export interface Usage {
	staticKeys: Set<string>;
	dynamicPrefixes: Set<string>;
}

export function usageFromText(text: string): Usage;
export function baseKey(key: string): string;
export function isKeyUsed(key: string, staticKeys: Set<string>, dynamicPrefixes: Set<string>): boolean;
export function isKeyPresent(key: string, flat: Record<string, unknown>): boolean;
