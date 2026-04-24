export declare function getClientManifest(): {
    import(id: string): Promise<any>;
    getAssets(id: string): Promise<any[]>;
} | {
    import(id: string): Promise<any>;
    getAssets(id: string): Promise<any>;
    json(): Promise<any>;
};
export { getClientManifest as getManifest };
