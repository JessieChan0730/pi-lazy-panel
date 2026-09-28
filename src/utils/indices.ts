/**
 * Small index helpers shared by the UI layer: clamping a cursor / scroll
 * position into range and finding the rows a predicate accepts. Pure
 * functions only (the lib target is ES2022, so no Array#findLastIndex).
 */

/** `n` limited to `[min, max]`. */
export function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

/** Index of the last element `pred` accepts, -1 when none does. */
export function findLastIndex<T>(arr: readonly T[], pred: (t: T) => boolean): number {
	for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
	return -1;
}

/** Indices of the elements `pred` accepts, ascending. */
export function indicesWhere<T>(arr: readonly T[], pred: (t: T, i: number) => boolean): number[] {
	const out: number[] = [];
	arr.forEach((t, i) => {
		if (pred(t, i)) out.push(i);
	});
	return out;
}
