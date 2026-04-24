import type { Asset } from "../assets/render.tsx";
export declare function getSsrProdManifest(): {
    path(id: string): string;
    getAssets(id: string): Promise<Asset[]>;
    json(): Promise<Record<string, any>>;
};
