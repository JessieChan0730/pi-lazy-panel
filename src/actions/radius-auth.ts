/**
 * Radius sign-in, mirroring pi's `/login radius`.
 *
 * pi exposes no extension API for `/login`, so the panel drives the same
 * pi-ai provider auth itself: a fresh `ModelRuntime` (same auth.json) provides
 * the Radius OAuth / API-key flows, and the UI answers its prompts. Sharing
 * only needs the stored credential, so after the login the running pi's
 * `modelRegistry` can read the new token (pi's auth storage reloads when the
 * file revision changes).
 *
 * Radius 登录：pi 没有给扩展开放 /login，这里用同一个 auth.json 新建一个
 * ModelRuntime，走 pi-ai 里 Radius 自己的 OAuth / API key 流程，UI 只负责回答提示。
 * 登录成功后凭据已落盘，运行中的 pi 通过 modelRegistry 就能读到（pi 的 auth.json
 * 读缓存会按文件版本自动刷新），随后继续原来的分享。
 */

import { spawn } from "node:child_process";
import { CredentialSynchronizationError, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { RadiusLoginInteraction, RadiusLoginMethod } from "../types.ts";

/** pi's provider id for Radius. */
export const RADIUS_PROVIDER_ID = "radius";

/** The slice of pi's runtime a login needs (tests pass a fake). */
export interface RadiusLoginRuntime {
	login(providerId: string, method: RadiusLoginMethod, interaction: RadiusLoginInteraction): Promise<unknown>;
}

export interface RadiusLoginOptions {
	/** Replaces the fresh `ModelRuntime` (tests). */
	runtime?: RadiusLoginRuntime;
}

/**
 * Sign in to Radius with an account (OAuth) or an API key, letting `interaction`
 * answer pi's prompts. Resolves once the credential is stored.
 *
 * `synchronizeCredentialState` can fail after the credential was written (e.g.
 * the model catalog could not be refreshed); that is not a login failure for
 * sharing, so it is ignored unless the user cancelled. Cancellation rejects.
 *
 * Throws when the flow fails or `interaction.signal` is aborted.
 */
export async function loginRadius(method: RadiusLoginMethod, interaction: RadiusLoginInteraction, options: RadiusLoginOptions = {}): Promise<void> {
	const runtime: RadiusLoginRuntime = options.runtime ?? (await ModelRuntime.create({ refreshOnCreate: false }));
	try {
		await runtime.login(RADIUS_PROVIDER_ID, method, interaction);
	} catch (err) {
		if (err instanceof CredentialSynchronizationError && !interaction.signal.aborted) return;
		throw err;
	}
}

/**
 * Open `url` in the platform's browser, best-effort (same commands as pi's
 * `openBrowser`). Never goes through a shell: the URL comes from the gateway.
 */
export function openExternalUrl(url: string): void {
	const [command, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", url]]
				: ["xdg-open", [url]];
	// 浏览器打不开（比如没装 xdg-open）不该让进程崩掉；提示框里仍然有 URL。
	spawn(command, args, { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
}
