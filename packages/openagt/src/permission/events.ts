// Permission bus event contracts.
// This file declares event payload shapes only; publishing stays in the service.

import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"
import { zod } from "@/util/effect-zod"
import { Schema } from "effect"
import { Reply, Request } from "./contracts"
import { PermissionID } from "./schema"

export const Event = {
  Asked: BusEvent.define("permission.asked", Request.zod),
  Replied: BusEvent.define(
    "permission.replied",
    zod(
      Schema.Struct({
        sessionID: SessionID,
        requestID: PermissionID,
        reply: Reply,
      }),
    ),
  ),
}
