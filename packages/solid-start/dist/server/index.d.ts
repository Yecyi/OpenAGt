export { default as lazy } from "../shared/lazy.ts";
export { getServerFunctionMeta } from "../shared/serverFunction.ts";
export { StartServer } from "./StartServer.tsx";
export { createHandler } from "./handler.ts";
/**
 * Checks if user has set a redirect status in the response.
 * If not, falls back to the 302 (temporary redirect)
 */
