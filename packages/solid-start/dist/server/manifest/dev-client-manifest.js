var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { join } from "pathe";
export function getClientDevManifest() {
    return {
        import(id) {
            return import(__rewriteRelativeImportExtension(/* @vite-ignore */ join("/", id), true));
        },
        async getAssets(id) {
            const assetsPath = `/@manifest/client/${Date.now()}/assets?id=${id}`;
            const assets = (await import(__rewriteRelativeImportExtension(/* @vite-ignore */ assetsPath, true))).default;
            return await Promise.all(assets.map(async (v) => ({
                ...v,
                children: await v.children()
            })));
        },
    };
}
