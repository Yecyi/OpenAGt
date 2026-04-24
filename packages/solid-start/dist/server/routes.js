// @ts-expect-error
import fileRoutes from "solid-start:routes";
import { createRouter } from "radix3";
export const pageRoutes = defineRoutes(fileRoutes.filter((o) => o.page));
function defineRoutes(fileRoutes) {
    function processRoute(routes, route, id, full) {
        const parentRoute = Object.values(routes).find((o) => {
            return id.startsWith(o.id + "/");
        });
        if (!parentRoute) {
            routes.push({
                ...route,
                id,
                path: id.replace(/\([^)/]+\)/g, "").replace(/\/+/g, "/"),
            });
            return routes;
        }
        processRoute(parentRoute.children || (parentRoute.children = []), route, id.slice(parentRoute.id.length), full);
        return routes;
    }
    return fileRoutes
        .sort((a, b) => a.path.length - b.path.length)
        .reduce((prevRoutes, route) => {
        return processRoute(prevRoutes, route, route.path, route.path);
    }, []);
}
const router = createRouter({
    routes: fileRoutes.reduce((memo, route) => {
        if (!containsHTTP(route))
            return memo;
        const path = route.path
            .replace(/\([^)/]+\)/g, "")
            .replace(/\/+/g, "/")
            .replace(/\*([^/]*)/g, (_, m) => `**:${m}`)
            .split("/")
            .map((s) => s.startsWith(":") || s.startsWith("*") ? s : encodeURIComponent(s))
            .join("/");
        if (/:[^/]*\?/g.test(path)) {
            throw new Error(`Optional parameters are not supported in API routes: ${path}`);
        }
        if (memo[path]) {
            throw new Error(`Duplicate API routes for "${path}" found at "${memo[path].route.path}" and "${route.path}"`);
        }
        memo[path] = { route };
        return memo;
    }, {}),
});
function containsHTTP(route) {
    return (route["$HEAD"] ||
        route["$GET"] ||
        route["$POST"] ||
        route["$PUT"] ||
        route["$PATCH"] ||
        route["$DELETE"]);
}
export function matchAPIRoute(path, method) {
    const match = router.lookup(path);
    if (match && match.route) {
        const route = match.route;
        // Find the appropriate handler for the HTTP method
        const handler = method === "HEAD" ? route.$HEAD || route.$GET : route[`$${method}`];
        if (handler === undefined)
            return;
        // Check if this is a page route
        const isPage = route.page === true && route.$component !== undefined;
        // Return comprehensive route information
        return {
            handler,
            params: match.params,
            isPage,
        };
    }
    return undefined;
}
