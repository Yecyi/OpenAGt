// @refresh skip
import { getFetchEvent } from "../server/fetchEvent.js";
function wrapRequestMiddleware(onRequest) {
    return async (h3Event) => {
        const fetchEvent = getFetchEvent(h3Event);
        const response = await onRequest(fetchEvent);
        if (response)
            return response;
    };
}
function wrapResponseMiddleware(onBeforeResponse) {
    return async (h3Event, next) => {
        const resp = await next();
        const fetchEvent = getFetchEvent(h3Event);
        const mwResponse = await onBeforeResponse(fetchEvent, {
            body: resp?.body,
        });
        if (mwResponse)
            return mwResponse;
    };
}
export function createMiddleware(args) {
    if (Array.isArray(args))
        return args;
    const mw = [];
    if (typeof args.onRequest === "function") {
        mw.push(wrapRequestMiddleware(args.onRequest));
    }
    else if (Array.isArray(args.onRequest)) {
        mw.push(...args.onRequest.map(wrapRequestMiddleware));
    }
    if (typeof args.onBeforeResponse === "function") {
        mw.push(wrapResponseMiddleware(args.onBeforeResponse));
    }
    else if (Array.isArray(args.onBeforeResponse)) {
        mw.push(...args.onBeforeResponse.map(wrapResponseMiddleware));
    }
    return mw;
}
