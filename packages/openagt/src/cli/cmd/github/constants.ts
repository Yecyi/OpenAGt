export const AGENT_USERNAME = "opencode-agent[bot]"
export const AGENT_REACTION = "eyes"
export const WORKFLOW_FILE = ".github/workflows/opencode.yml"

// Event categories for routing
// USER_EVENTS: triggered by user actions, have actor/issueId, support reactions/comments
// REPO_EVENTS: triggered by automation, no actor/issueId, output to logs/PR only
export const USER_EVENTS = ["issue_comment", "pull_request_review_comment", "issues", "pull_request"] as const
export const REPO_EVENTS = ["schedule", "workflow_dispatch"] as const
export const SUPPORTED_EVENTS = [...USER_EVENTS, ...REPO_EVENTS] as const

export type UserEvent = (typeof USER_EVENTS)[number]
export type RepoEvent = (typeof REPO_EVENTS)[number]
