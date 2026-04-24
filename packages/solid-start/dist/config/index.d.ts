import { type PluginOption } from "vite";
import { type Options as SolidOptions } from "vite-plugin-solid";
export interface SolidStartOptions {
    solid?: Partial<SolidOptions>;
    ssr?: boolean;
    routeDir?: string;
    extensions?: string[];
    middleware?: string;
}
export declare function solidStart(options?: SolidStartOptions): Array<PluginOption>;
