import { type EventHandler, type H3Event, type Middleware } from "h3";
import type { FetchEvent } from "./types.ts";
export declare function createFetchEvent(event: H3Event): FetchEvent;
export declare function getFetchEvent(h3Event: H3Event): FetchEvent;
export declare function mergeResponseHeaders(h3Event: H3Event, headers: Headers): void;
export declare const decorateHandler: <T extends EventHandler>(fn: T) => T;
export declare const decorateMiddleware: <T extends Middleware>(fn: T) => T;
