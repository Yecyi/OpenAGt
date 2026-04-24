import type { JSX } from "solid-js";
import type { HandlerOptions, PageEvent } from "../types.ts";
/**
 *
 * Read more: https://docs.solidjs.com/solid-start/reference/server/create-handler
 */
export declare function createHandler(fn: (context: PageEvent) => JSX.Element, options?: HandlerOptions | ((context: PageEvent) => HandlerOptions)): import("h3").H3;
