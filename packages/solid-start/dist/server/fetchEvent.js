import { getRequestIP } from "h3";
import { provideRequestEvent } from "solid-js/web/storage";
const FETCH_EVENT_CONTEXT = "solidFetchEvent";
export function createFetchEvent(event) {
    return {
        request: event.req,
        response: event.res,
        clientAddress: getRequestIP(event),
        locals: {},
        nativeEvent: event,
    };
}
export function getFetchEvent(h3Event) {
    if (!h3Event.context[FETCH_EVENT_CONTEXT]) {
        const fetchEvent = createFetchEvent(h3Event);
        h3Event.context[FETCH_EVENT_CONTEXT] = fetchEvent;
    }
    return h3Event.context[FETCH_EVENT_CONTEXT];
}
export function mergeResponseHeaders(h3Event, headers) {
    for (const [key, value] of headers.entries()) {
        h3Event.res.headers.append(key, value);
    }
}
export const decorateHandler = (fn) => (event => provideRequestEvent(getFetchEvent(event), () => fn(event)));
export const decorateMiddleware = (fn) => ((event, next) => provideRequestEvent(getFetchEvent(event), () => fn(event, next)));
