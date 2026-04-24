import type { FetchEvent } from "./types.ts";
interface Route {
    path: string;
    id: string;
    children?: Route[];
    page?: boolean;
    $component?: any;
    $HEAD?: any;
    $GET?: any;
    $POST?: any;
    $PUT?: any;
    $PATCH?: any;
    $DELETE?: any;
}
export declare const pageRoutes: Route[];
export declare function matchAPIRoute(path: string, method: string): {
    params?: Record<string, any>;
    handler: {
        import: () => Promise<Record<string, (e: FetchEvent) => Promise<any>>>;
    };
    isPage: boolean;
} | undefined;
export {};
