import * as h3 from "h3";
import { getRequestEvent } from "solid-js/web";
function _setContext(event, key, value) {
    event.context[key] = value;
}
function _getContext(event, key) {
    return event.context[key];
}
function getEvent() {
    return getRequestEvent().nativeEvent;
}
export function getWebRequest() {
    return getEvent().req;
}
export const HTTPEventSymbol = Symbol("$HTTPEvent");
export function isEvent(obj) {
    return (typeof obj === "object" &&
        (obj instanceof h3.H3Event ||
            obj?.[HTTPEventSymbol] instanceof h3.H3Event ||
            obj?.__is_event__ === true));
    // Implement logic to check if obj is an H3Event
}
function createWrapperFunction(h3Function) {
    return ((...args) => {
        const event = args[0];
        if (!isEvent(event)) {
            args.unshift(getEvent());
        }
        else {
            args[0] =
                event instanceof h3.H3Event || event.__is_event__
                    ? event
                    : event[HTTPEventSymbol];
        }
        return h3Function(...args);
    });
}
export const readBody = createWrapperFunction(h3.readBody);
export const getQuery = createWrapperFunction(h3.getQuery);
export const isMethod = createWrapperFunction(h3.isMethod);
export const isPreflightRequest = createWrapperFunction(h3.isPreflightRequest);
export const getValidatedQuery = createWrapperFunction(h3.getValidatedQuery);
export const getRouterParams = createWrapperFunction(h3.getRouterParams);
export const getRouterParam = createWrapperFunction(h3.getRouterParam);
export const getValidatedRouterParams = createWrapperFunction(h3.getValidatedRouterParams);
export const assertMethod = createWrapperFunction(h3.assertMethod);
export const getRequestHeaders = createWrapperFunction(h3.getRequestHeaders);
export const getRequestHeader = createWrapperFunction(h3.getRequestHeader);
export const getRequestURL = createWrapperFunction(h3.getRequestURL);
export const getRequestHost = createWrapperFunction(h3.getRequestHost);
export const getRequestProtocol = createWrapperFunction(h3.getRequestProtocol);
export const getRequestIP = createWrapperFunction(h3.getRequestIP);
export const setResponseStatus = (code, text) => {
    const e = getEvent();
    if (e.res.status !== undefined)
        e.res.status = code;
    if (e.res.statusText !== undefined)
        e.res.statusText = text;
};
export const getResponseStatus = () => getEvent().res.status;
export const getResponseStatusText = () => getEvent().res.statusText;
export const getResponseHeaders = () => Object.fromEntries(getEvent().res.headers.entries());
export const getResponseHeader = (name) => getEvent().res.headers.get(name);
export const setResponseHeaders = (values) => {
    const headers = getEvent().res.headers;
    for (const [name, value] of Object.entries(values)) {
        headers.set(name, value);
    }
};
export const setResponseHeader = (name, value) => {
    const headers = getEvent().res.headers;
    (Array.isArray(value) ? value : [value]).forEach((value) => {
        headers.set(name, value);
    });
};
export const appendResponseHeaders = (values) => {
    const headers = getEvent().res.headers;
    for (const [name, value] of Object.entries(values)) {
        headers.append(name, value);
    }
};
export const appendResponseHeader = (name, value) => {
    const headers = getEvent().res.headers;
    (Array.isArray(value) ? value : [value]).forEach((value) => {
        headers.append(name, value);
    });
};
export const defaultContentType = (type) => getEvent().res.headers.set("content-type", type);
export const proxyRequest = createWrapperFunction(h3.proxyRequest);
export const fetchWithEvent = createWrapperFunction(h3.fetchWithEvent);
export const getProxyRequestHeaders = createWrapperFunction(h3.getProxyRequestHeaders);
export const parseCookies = createWrapperFunction(h3.parseCookies);
export const getCookie = createWrapperFunction(h3.getCookie);
export const setCookie = createWrapperFunction(h3.setCookie);
export const deleteCookie = createWrapperFunction(h3.deleteCookie);
export const useSession = createWrapperFunction(h3.useSession);
export const getSession = createWrapperFunction(h3.getSession);
export const updateSession = createWrapperFunction(h3.updateSession);
export const sealSession = createWrapperFunction(h3.sealSession);
export const unsealSession = createWrapperFunction(h3.unsealSession);
export const clearSession = createWrapperFunction(h3.clearSession);
export const handleCacheHeaders = createWrapperFunction(h3.handleCacheHeaders);
export const handleCors = createWrapperFunction(h3.handleCors);
export const appendCorsHeaders = createWrapperFunction(h3.appendCorsHeaders);
export const appendCorsPreflightHeaders = createWrapperFunction(h3.appendCorsPreflightHeaders);
export const appendHeader = appendResponseHeader;
export const appendHeaders = appendResponseHeaders;
export const setHeader = setResponseHeader;
export const setHeaders = setResponseHeaders;
export const getHeader = getResponseHeader;
export const getHeaders = getResponseHeaders;
export const getRequestFingerprint = createWrapperFunction(h3.getRequestFingerprint);
export const getRequestWebStream = () => getEvent().req.body;
export const readFormData = () => getEvent().req.formData();
export const readValidatedBody = createWrapperFunction(h3.readValidatedBody);
export const getContext = createWrapperFunction(_getContext);
export const setContext = createWrapperFunction(_setContext);
export const removeResponseHeader = (name) => getEvent().res.headers.delete(name);
export const clearResponseHeaders = (headerNames) => {
    const headers = getEvent().res.headers;
    if (headerNames && headerNames.length > 0) {
        for (const name of headerNames) {
            headers.delete(name);
        }
    }
    else {
        for (const name of headers.keys()) {
            headers.delete(name);
        }
    }
};
