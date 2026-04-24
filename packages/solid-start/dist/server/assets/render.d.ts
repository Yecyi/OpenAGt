import type { JSX } from "solid-js";
export declare function renderAsset(asset: Asset, nonce?: string): any;
export type Asset = {
    tag: "style";
    attrs: JSX.StyleHTMLAttributes<HTMLStyleElement> & {
        key?: string;
    };
    children?: JSX.Element;
} | {
    tag: "script";
    attrs: JSX.ScriptHTMLAttributes<HTMLScriptElement> & {
        key?: string;
    };
} | {
    tag: "link";
    attrs: JSX.LinkHTMLAttributes<HTMLLinkElement> & {
        key?: string;
    };
};
