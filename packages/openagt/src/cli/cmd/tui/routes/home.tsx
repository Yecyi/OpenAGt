import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createSignal, For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useProject } from "../context/project"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { TuiPluginRuntime } from "../plugin"
import { useTheme } from "../context/theme"
import { useCommandDialog } from "../component/dialog-command"
import { DialogSelect } from "../ui/dialog-select"
import { missionEffortOptions } from "./mission-create"

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
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const { theme } = useTheme()
  const command = useCommandDialog()
  let sent = false

  command.register(() => [
    {
      title: "Change effort",
      value: "effort.change",
      description: "Set the default effort for the next prompt or mission",
      slash: {
        name: "effort",
      },
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogSelect<(typeof missionEffortOptions)[number]["value"]>
            title="Agent effort"
            placeholder="Select effort"
            skipFilter
            current={local.effort.current()}
            options={missionEffortOptions.map((item) => ({
              title: item.title,
              value: item.value,
              description: item.description,
            }))}
            onSelect={(option) => {
              local.effort.set(option.value)
              dialog.clear()
            }}
          />
        ))
      },
      category: "Agent",
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

  const EffortControl = () => (
    <box width="100%" maxWidth={HOME_WIDTH} paddingTop={1} flexShrink={0} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text fg={theme.textMuted} wrapMode="none">
          Agent effort
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          /effort
        </text>
      </box>
      <box flexDirection="row" gap={1} flexWrap="wrap">
        <For each={missionEffortOptions}>
          {(item) => {
            const selected = () => local.effort.current() === item.value
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={selected() ? theme.backgroundElement : undefined}
                onMouseUp={() => local.effort.set(item.value)}
              >
                <text
                  fg={selected() ? theme.warning : theme.textMuted}
                  attributes={selected() ? TextAttributes.BOLD : undefined}
                >
                  {item.title.toLowerCase()}
                </text>
              </box>
            )
          }}
        </For>
      </box>
      <text fg={theme.textMuted}>applies to the next prompt and mission</text>
    </box>
  )

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
        <EffortControl />
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
