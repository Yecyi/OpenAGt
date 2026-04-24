export declare function getSsrDevManifest(environment: "client" | "ssr"): {
    path: (id: string) => string;
    getAssets(id: string): Promise<any[]>;
};
export { getSsrDevManifest as getSsrManifest };
