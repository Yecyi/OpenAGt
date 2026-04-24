import { getSsrDevManifest } from "./dev-ssr-manifest.ts";
import { getSsrProdManifest } from "./prod-ssr-manifest.ts";
export declare function getSsrManifest(target: "client" | "ssr"): ReturnType<typeof getSsrDevManifest> | ReturnType<typeof getSsrProdManifest>;
export { getSsrManifest as getManifest };
