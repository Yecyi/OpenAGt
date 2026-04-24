import type { PluginOption } from "vite";
import type { BaseFileSystemRouter } from "./router.ts";
export declare const fileSystemWatcher: (routers: Record<"client" | "ssr", BaseFileSystemRouter>) => PluginOption;
