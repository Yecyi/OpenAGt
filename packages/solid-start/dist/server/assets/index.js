import { onCleanup, sharedConfig } from "solid-js";
import { getRequestEvent, useAssets as useAssets_ } from "solid-js/web";
import { renderAsset } from "./render.jsx";
const REGISTRY = Symbol("assetRegistry");
const NOOP = () => "";
const keyAttrs = ["href", "rel", "data-vite-dev-id"];
const getEntity = (registry, asset) => {
    let key = asset.tag;
    for (const k of keyAttrs) {
        if (!(k in asset.attrs))
            continue;
        key += `[${k}='${asset.attrs[k]}']`;
    }
    const entity = (registry[key] ??= {
        key,
        consumers: 0
    });
    return entity;
};
export const useAssets = (assets, nonce) => {
    if (!assets.length)
        return;
    const registry = (getRequestEvent().locals[REGISTRY] ??= {});
    const ssrRequestAssets = sharedConfig.context?.assets;
    const cssKeys = [];
    for (const asset of assets) {
        const entity = getEntity(registry, asset);
        const isCSSLink = asset.tag === "link" && asset.attrs.rel === "stylesheet";
        const isCSS = isCSSLink || asset.tag === "style";
        if (isCSS) {
            cssKeys.push(entity.key);
        }
        entity.consumers++;
        if (entity.consumers > 1)
            continue;
        // Mounting logic
        useAssets_(() => renderAsset(asset, nonce));
        entity.ssrIdx = ssrRequestAssets.length - 1;
    }
    onCleanup(() => {
        for (const key of cssKeys) {
            const entity = registry[key];
            entity.consumers--;
            if (entity.consumers != 0) {
                continue;
            }
            // Ideally this logic should be implemented directly in dom-expressions
            ssrRequestAssets.splice(entity.ssrIdx, 1, NOOP);
            delete registry[key];
        }
    });
};
