import { H3 } from "h3";
import type { JSX } from "solid-js";
import type { FetchEvent, HandlerOptions, PageEvent } from "./types.ts";
export declare function createBaseHandler(createPageEvent: (e: FetchEvent) => Promise<PageEvent>, fn: (context: PageEvent) => JSX.Element, options?: HandlerOptions | ((context: PageEvent) => HandlerOptions | Promise<HandlerOptions>)): H3;
export declare function createHandler(fn: (context: PageEvent) => JSX.Element, options?: HandlerOptions | ((context: PageEvent) => HandlerOptions | Promise<HandlerOptions>)): H3;
export declare function createPageEvent(ctx: FetchEvent): Promise<PageEvent>;
