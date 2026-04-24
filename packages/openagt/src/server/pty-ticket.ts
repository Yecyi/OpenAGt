import crypto from "node:crypto"

const TICKET_TTL = 60_000
const tickets = new Map<string, { ptyID: string; directory: string; expires: number }>()

export const PtyTicket = {
  issue(input: { ptyID: string; directory?: string }) {
    prune()
    const token = crypto.randomBytes(32).toString("base64url")
    const expires = Date.now() + TICKET_TTL
    tickets.set(token, {
      ptyID: input.ptyID,
      directory: input.directory ?? "",
      expires,
    })
    return { token, expires }
  },

  consume(input: { token?: string | null; ptyID: string; directory?: string }) {
    if (!input.token) return false
    const ticket = tickets.get(input.token)
    tickets.delete(input.token)
    if (!ticket) return false
    if (ticket.expires < Date.now()) return false
    return ticket.ptyID === input.ptyID && ticket.directory === (input.directory ?? "")
  },

  matchConnect(path: string) {
    return /^\/pty\/([^/]+)\/connect$/.exec(path)?.[1]
  },
}

function prune() {
  const now = Date.now()
  for (const [token, ticket] of tickets) {
    if (ticket.expires < now) tickets.delete(token)
  }
}
