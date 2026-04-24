var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { join, normalize } from "pathe";
export function getSsrDevManifest(environment) {
    return {
        path: (id) => normalize(join(import.meta.env.BASE_URL, id)),
        async getAssets(id) {
            const assetsPath = `/@manifest/${environment}/${Date.now()}/assets?id=${id}`;
            const assets = (await import(__rewriteRelativeImportExtension(/* @vite-ignore */ assetsPath, true))).default;
            return await Promise.all(assets.map(async (v) => ({
                ...v,
                children: await v.children()
            })));
        },
    };
}
export { getSsrDevManifest as getSsrManifest };
