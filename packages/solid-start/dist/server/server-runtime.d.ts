import { type Component } from "solid-js";
export declare function createServerReference(id: string): (...args: any[]) => Promise<any>;
export declare function createClientReference(Component: Component<any>, id: string): Component<any>;
