// @refresh skip
import { ErrorBoundary, Show, createEffect, createSignal, onCleanup, resetErrorBoundaries } from "solid-js";
import { HttpStatusCode } from "../HttpStatusCode.js";
import clientOnly from "../clientOnly.js";
const DevOverlayDialog = import.meta.env.PROD
    ? () => <></>
    : clientOnly(() => import("./DevOverlayDialog"), { lazy: true });
export function DevOverlay(props) {
    const [errors, setErrors] = createSignal([]);
    function resetError() {
        setErrors([]);
        resetErrorBoundaries();
    }
    function pushError(error) {
        console.error(error);
        setErrors(current => [error, ...current]);
    }
    createEffect(() => {
        const onErrorEvent = (error) => {
            pushError(error.error ?? error);
        };
        window.addEventListener("error", onErrorEvent);
        onCleanup(() => {
            window.removeEventListener("error", onErrorEvent);
        });
    });
    return (<>
      <ErrorBoundary fallback={error => {
            pushError(error);
            return <HttpStatusCode code={500}/>;
        }}>
        {props.children}
      </ErrorBoundary>
      <Show when={errors().length}>
        <HttpStatusCode code={500}/>
        <DevOverlayDialog errors={errors()} resetError={resetError}/>
      </Show>
    </>);
}
