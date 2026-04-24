import { DevEnvironment, Rollup } from "vite";
export declare function cleanUrl(url: string): string;
export declare const FS_PREFIX = "/@fs/";
export declare const VALID_ID_PREFIX = "/@id/";
export declare const NULL_BYTE_PLACEHOLDER = "__x00__";
export declare function normalizeResolvedIdToUrl(environment: DevEnvironment, url: string, resolved: Rollup.PartialResolvedId): string;
export declare function wrapId(id: string): string;
export declare function unwrapId(id: string): string;
export declare function normalizeViteImportAnalysisUrl(environment: DevEnvironment, id: string): string;
export declare function withTrailingSlash(path: string): string;
export declare function splitFileAndPostfix(path: string): {
    file: string;
    postfix: string;
};
export declare function slash(p: string): string;
export declare function injectQuery(url: string, queryToInject: string): string;
