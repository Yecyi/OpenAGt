import { type PluginOption } from "vite";
import type { BaseFileSystemRouter } from "./router.ts";
export declare const moduleId = "solid-start:routes";
export interface FsRoutesArgs {
    routers: Record<"client" | "ssr", BaseFileSystemRouter>;
}
export declare function fsRoutes({ routers }: FsRoutesArgs): Array<PluginOption>;
