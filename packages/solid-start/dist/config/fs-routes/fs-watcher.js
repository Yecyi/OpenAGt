import { moduleId } from "./index.js";
function setupWatcher(watcher, routes) {
    watcher.on("unlink", (path) => routes.removeRoute(path));
    watcher.on("add", (path) => routes.addRoute(path));
    watcher.on("change", (path) => routes.updateRoute(path));
}
function createRoutesReloader(server, routes, environment) {
    routes.addEventListener("reload", handleRoutesReload);
    return () => routes.removeEventListener("reload", handleRoutesReload);
    function handleRoutesReload() {
        if (environment === "ssr") {
            // Handle server environment HMR reload
            const serverEnv = server.environments.server;
            if (serverEnv && serverEnv.moduleGraph) {
                const mod = serverEnv.moduleGraph.getModuleById(moduleId);
                if (mod) {
                    const seen = new Set();
                    serverEnv.moduleGraph.invalidateModule(mod, seen);
                }
            }
        }
        else {
            // Handle client environment HMR reload
            const { moduleGraph } = server;
            const mod = moduleGraph.getModuleById(moduleId);
            if (mod) {
                const seen = new Set();
                moduleGraph.invalidateModule(mod, seen);
                server.reloadModule(mod);
            }
        }
        if (!server.hot) {
            server.ws.send({ type: "full-reload" });
        }
    }
}
export const fileSystemWatcher = (routers) => {
    const plugin = {
        name: "fs-watcher",
        async configureServer(server) {
            Object.keys(routers).forEach((environment) => {
                const router = globalThis.ROUTERS[environment];
                setupWatcher(server.watcher, router);
                createRoutesReloader(server, router, environment);
            });
        },
    };
    return plugin;
};
