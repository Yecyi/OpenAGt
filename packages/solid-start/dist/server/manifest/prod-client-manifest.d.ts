export declare function getClientProdManifest(): {
    import(id: string): Promise<any>;
    getAssets(id: string): Promise<any>;
    json(): Promise<any>;
};
