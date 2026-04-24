import type { Middleware } from "h3";
import type { FetchEvent } from "../server/types.ts";
/** Function responsible for receiving an observable [operation]{@link Operation} and returning a [result]{@link OperationResult}. */
export type MiddlewareFn = (event: FetchEvent) => Promise<unknown> | unknown;
/** This composes an array of Exchanges into a single ExchangeIO function */
export type RequestMiddleware = (event: FetchEvent) => Response | Promise<Response> | void | Promise<void> | Promise<void | Response>;
type EventHandlerResponse<T = any> = T | Promise<T>;
type ResponseMiddlewareResponseParam = {
    body?: Awaited<EventHandlerResponse>;
};
export type ResponseMiddleware = (event: FetchEvent, response: ResponseMiddlewareResponseParam) => Response | Promise<Response> | void | Promise<void>;
export declare function createMiddleware(args: {
    /** @deprecated Use H3 `Middleware` */
    onRequest?: RequestMiddleware | RequestMiddleware[] | undefined;
    /** @deprecated Use H3 `Middleware` */
    onBeforeResponse?: ResponseMiddleware | ResponseMiddleware[] | undefined;
} | Middleware[]): Middleware[];
export {};
