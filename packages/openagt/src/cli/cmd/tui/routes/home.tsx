import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useProject } from "../context/project"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRoute, useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { TuiPluginRuntime } from "../plugin"
import { useTheme } from "../context/theme"
import { useCommandDialog } from "../component/dialog-command"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"

let once = false
const HOME_WIDTH = 75
const placeholder = {
  normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
  shell: ["ls -la", "git status", "pwd"],
}
const wordmark = [
  {
    open: "  ██████  ██████  ███████ ███    ██ ",
    agt: "   █████   ██████  █████ ",
  },
  {
    open: " ██    ██ ██   ██ ██      ████   ██ ",
    agt: "  ██   ██ ██         ██  ",
  },
  {
    open: " ██    ██ ██████  █████   ██ ██  ██ ",
    agt: "  ███████ ██   ███   ██  ",
  },
  {
    open: " ██    ██ ██      ██      ██  ██ ██ ",
    agt: "  ██   ██ ██    ██   ██  ",
  },
  {
    open: "  ██████  ██      ███████ ██   ████ ",
    agt: "  ██   ██  ██████    ██  ",
  },
]

export function Home() {
  const sync = useSync()
  const project = useProject()
  const route = useRouteData("home")
  const router = useRoute()
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const { theme } = useTheme()
  const command = useCommandDialog()
  const sdk = useSDK()
  const toast = useToast()
  let sent = false

  command.register(() => [
    {
      title: "Create mission",
      value: "mission.create",
      description: "Analyze a goal and start a coordinator mission",
      slash: {
        name: "mission",
      },
      onSelect: async (dialog) => {
        const goal = await DialogPrompt.show(dialog, "New mission", {
          placeholder: "Describe the outcome you want",
        })
        const text = goal?.trim()
        if (!text) return
        try {
          const session = (await sdk.client.session.create({ title: text.slice(0, 80) || "Mission" }, { throwOnError: true })).data
          const intent = (await sdk.client.coordinator.intent.settle({ goal: text }, { throwOnError: true })).data
          const plan = (await sdk.client.coordinator.plan2.generate({ goal: text, intent }, { throwOnError: true })).data
          const mode = intent.risk_level === "high" ? "assisted" : "autonomous"
          const run = (
            await sdk.client.coordinator.run(
              {
                sessionID: session.id,
                goal: text,
                intent,
                mode,
                nodes: plan.nodes,
              },
              { throwOnError: true },
            )
          ).data
          router.navigate({
            type: "mission",
            sessionID: session.id,
            runID: run.id,
          })
        } catch (error) {
          toast.error(error)
        }
      },
      category: "Mission",
    },
  ])

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.prompt) {
      r.set(route.prompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box height={4} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={HOME_WIDTH} flexShrink={0} justifyContent="center">
          <TuiPluginRuntime.Slot name="home_logo" mode="replace">
            <box width="100%" flexDirection="column" alignItems="center">
              {wordmark.map((line) => (
                <box flexDirection="row">
                  <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                    {line.open}
                  </text>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {line.agt}
                  </text>
                </box>
              ))}
            </box>
          </TuiPluginRuntime.Slot>
        </box>
        <box height={1} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={HOME_WIDTH} zIndex={1000} paddingTop={1} flexShrink={0}>
          <TuiPluginRuntime.Slot
            name="home_prompt"
            mode="replace"
            workspace_id={project.workspace.current()}
            ref={bind}
          >
            <Prompt
              ref={bind}
              workspaceID={project.workspace.current()}
              right={<TuiPluginRuntime.Slot name="home_prompt_right" workspace_id={project.workspace.current()} />}
              placeholders={placeholder}
            />
          </TuiPluginRuntime.Slot>
        </box>
        <TuiPluginRuntime.Slot name="home_bottom" />
        <box flexGrow={1} minHeight={0} />
        <Toast />
      </box>
      <box width="100%" flexShrink={0}>
        <TuiPluginRuntime.Slot name="home_footer" mode="single_winner" />
      </box>
    </>
  )
}
