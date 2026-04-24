import { Hydration, HydrationScript, NoHydration, getRequestEvent, ssr } from "solid-js/web";
import App from "solid-start:app";
import { ErrorBoundary, TopErrorBoundary } from "../shared/ErrorBoundary.jsx";
import { useAssets } from "./assets/index.js";
import { getSsrManifest } from "./manifest/ssr-manifest.js";
const docType = ssr("<!DOCTYPE html>");
/**
 *
 * Read more: https://docs.solidjs.com/solid-start/reference/server/start-server
 */
export function StartServer(props) {
    const context = getRequestEvent();
    // @ts-ignore
    const nonce = context.nonce;
    useAssets(context.assets, nonce);
    return (<NoHydration>
      {docType}
      <TopErrorBoundary>
        <props.document assets={<HydrationScript />} scripts={<>
              <script type="module" nonce={nonce} async src={getSsrManifest("client").path(import.meta.env.START_CLIENT_ENTRY)}/>
            </>}>
          {!import.meta.env.START_ISLANDS ? (<Hydration>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </Hydration>) : (<ErrorBoundary>
              <App />
            </ErrorBoundary>)}
        </props.document>
      </TopErrorBoundary>
    </NoHydration>);
}
