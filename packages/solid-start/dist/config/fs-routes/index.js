import { relative } from "node:path";
import { fileSystemWatcher } from "./fs-watcher.js";
import { treeShake } from "./tree-shake.js";
export const moduleId = "solid-start:routes";
export function fsRoutes({ routers }) {
    globalThis.ROUTERS = routers;
    return [
        {
            name: "solid-start-fs-routes",
            enforce: "pre",
            resolveId(id) {
                if (id === moduleId)
                    return id;
            },
            async load(id) {
                const root = this.environment.config.root;
                const isBuild = this.environment.mode === "build";
                if (id !== moduleId)
                    return;
                const js = jsCode();
                const router = globalThis.ROUTERS[this.environment.name];
                const routes = await router.getRoutes();
                let routesCode = JSON.stringify(routes ?? [], (k, v) => {
                    if (v === undefined)
                        return undefined;
                    if (k.startsWith("$$")) {
                        const buildId = `${v.src}?${v.pick.map((p) => `pick=${p}`).join("&")}`;
                        /**
                         * @type {{ [key: string]: string }}
                         */
                        const refs = {};
                        for (var pick of v.pick) {
                            refs[pick] = js.addNamedImport(pick, buildId);
                        }
                        return {
                            require: `_$() => ({ ${Object.entries(refs)
                                .map(([pick, namedImport]) => `'${pick}': ${namedImport}`)
                                .join(", ")} })$_`,
                            // src: isBuild ? relative(root, buildId) : buildId
                        };
                    }
                    else if (k.startsWith("$")) {
                        const buildId = `${v.src}?${v.pick.map((p) => `pick=${p}`).join("&")}`;
                        return {
                            src: relative(root, buildId),
                            build: isBuild
                                ? `_$() => import(/* @vite-ignore */ '${buildId}')$_`
                                : undefined,
                            import: `_$() => import(/* @vite-ignore */ '${buildId}')$_`
                        };
                    }
                    return v;
                });
                routesCode = routesCode.replaceAll('"_$(', "(").replaceAll(')$_"', ")");
                const code = `
${js.getImportStatements()}
export default ${routesCode}`;
                return code;
            },
        },
        treeShake(),
        fileSystemWatcher(routers),
    ];
}
function jsCode() {
    const imports = new Map();
    let vars = 0;
    function addImport(p) {
        let id = imports.get(p);
        if (!id) {
            id = {};
            imports.set(p, id);
        }
        const d = "routeData" + vars++;
        id["default"] = d;
        return d;
    }
    function addNamedImport(name, p) {
        let id = imports.get(p);
        if (!id) {
            id = {};
            imports.set(p, id);
        }
        const d = "routeData" + vars++;
        id[name] = d;
        return d;
    }
    const getNamedExport = (p) => {
        const id = imports.get(p);
        delete id["default"];
        return Object.keys(id).length > 0
            ? `{ ${Object.keys(id)
                .map((k) => `${k} as ${id[k]}`)
                .join(", ")} }`
            : "";
    };
    const getImportStatements = () => {
        return `${[...imports.keys()]
            .map((i) => `import ${imports.get(i).default
            ? `${imports.get(i).default}${Object.keys(imports.get(i)).length > 1 ? ", " : ""}`
            : ""} ${getNamedExport(i)} from '${i}';`)
            .join("\n")}`;
    };
    return {
        addImport,
        addNamedImport,
        getImportStatements,
    };
}
