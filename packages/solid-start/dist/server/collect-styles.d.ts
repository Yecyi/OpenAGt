import type { DevEnvironment } from "vite";
export declare const isCssModulesFile: (file: string) => boolean;
export declare function findStylesInModuleGraph(vite: DevEnvironment, id: string): Promise<Record<string, any>>;
