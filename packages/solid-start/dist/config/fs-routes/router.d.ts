import { pathToRegexp } from "path-to-regexp";
export { pathToRegexp };
export declare const glob: (path: string) => string[];
export type FileSystemRouterConfig = {
    dir: string;
    extensions: string[];
};
type Route = {
    path: string;
} & Record<string, any>;
export declare function cleanPath(src: string, config: FileSystemRouterConfig): string;
export declare function analyzeModule(src: string): readonly [imports: readonly import("es-module-lexer").ImportSpecifier[], exports: readonly import("es-module-lexer").ExportSpecifier[], facade: boolean, hasModuleSyntax: boolean];
export declare class BaseFileSystemRouter extends EventTarget {
    routes: Route[];
    config: FileSystemRouterConfig;
    /**
     *
     * @param {} config
     */
    constructor(config: FileSystemRouterConfig);
    glob(): string;
    buildRoutes(): Promise<any[]>;
    isRoute(src: string): boolean;
    toPath(src: string): void;
    toRoute(src: string): Route | undefined;
    /**
     * To be attached by vite plugin to the vite dev server
     */
    update: undefined;
    _addRoute(route: Route): void;
    addRoute(src: string): Promise<void>;
    reload(route: string): void;
    updateRoute(src: string): Promise<void>;
    removeRoute(src: string): void;
    buildRoutesPromise?: Promise<any[]>;
    getRoutes(): Promise<Route[]>;
}
