/// <reference types="@solidjs/start/env" />

import type { Actor } from "@openagt/console-core/actor.js"

export declare module "@solidjs/start/server" {
  export type APIEvent = { request: Request }
}

declare module "solid-js/web" {
  interface RequestEvent {
    locals: {
      actor?: Actor.Info | Promise<Actor.Info>
      [key: string]: unknown
    }
  }
}
