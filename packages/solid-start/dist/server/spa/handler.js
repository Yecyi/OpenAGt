import { createBaseHandler } from "../handler.js";
import { getSsrManifest } from "../manifest/ssr-manifest.js";
/**
 *
 * Read more: https://docs.solidjs.com/solid-start/reference/server/create-handler
 */
export function createHandler(fn, options) {
    return createBaseHandler(createPageEvent, fn, options);
}
async function createPageEvent(ctx) {
    const manifest = getSsrManifest("ssr");
    const pageEvent = Object.assign(ctx, {
        manifest: "json" in manifest ? await manifest.json() : {},
        assets: await manifest.getAssets(import.meta.env.START_CLIENT_ENTRY),
        routes: [],
        complete: false,
        $islands: new Set(),
    });
    return pageEvent;
}
