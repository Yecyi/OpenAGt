import { BaseFileSystemRouter, type FileSystemRouterConfig } from "./fs-routes/router.ts";
export declare class SolidStartClientFileRouter extends BaseFileSystemRouter {
    toPath(src: string): string;
    toRoute(src: string): {
        page: boolean;
        $component: {
            src: string;
            pick: string[];
        };
        $$route: {
            src: string;
            pick: string[];
        } | undefined;
        path: string;
    } | undefined;
}
export declare class SolidStartServerFileRouter extends BaseFileSystemRouter {
    config: FileSystemRouterConfig & {
        dataOnly?: boolean;
    };
    constructor(config: FileSystemRouterConfig & {
        dataOnly?: boolean;
    });
    toPath(src: string): string;
    toRoute(src: string): {
        path: string;
        page: boolean;
        $component: {
            src: string;
            pick: string[];
        } | undefined;
        $$route: {
            src: string;
            pick: string[];
        } | undefined;
    } | undefined;
}
