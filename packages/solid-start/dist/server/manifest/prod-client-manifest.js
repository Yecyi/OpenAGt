var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
export function getClientProdManifest() {
    return {
        import(id) {
            // @ts-ignore
            return import(__rewriteRelativeImportExtension(/* @vite-ignore */ window.manifest[id].output, true));
        },
        async getAssets(id) {
            if (id.startsWith("./"))
                id = id.slice(2);
            // @ts-ignore
            return window.manifest[id]?.assets ?? [];
        },
        async json() {
            // @ts-ignore
            return window.manifest;
        },
    };
}
