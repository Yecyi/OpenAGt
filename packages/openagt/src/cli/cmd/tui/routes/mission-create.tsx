import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import type { DialogContext } from "@tui/ui/dialog"
import type { RouteContext } from "@tui/context/route"
import type { useLocal } from "@tui/context/local"
import type { useSDK } from "@tui/context/sdk"
import type { useToast } from "@tui/ui/toast"

export const missionEffortOptions = [
  { title: "Medium", value: "medium", description: "default planner + expert + verifier" },
  { title: "Low", value: "low", description: "fast single-expert path" },
  { title: "High", value: "high", description: "multi-round + multi-expert + reviewer" },
  { title: "Deep", value: "deep", description: "full revise and verification governance" },
] as const

export async function startMissionFromDialog(input: {
  dialog: DialogContext
  local: ReturnType<typeof useLocal>
  route: RouteContext
  sdk: ReturnType<typeof useSDK>
  toast: ReturnType<typeof useToast>
}) {
  const goal = await DialogPrompt.show(input.dialog, "New mission", {
    placeholder: "Describe the outcome you want",
  })
  const text = goal?.trim()
  if (!text) return
  const effort = await new Promise<(typeof missionEffortOptions)[number]["value"] | undefined>((resolve) => {
    input.dialog.replace(
      () => (
        <DialogSelect<(typeof missionEffortOptions)[number]["value"]>
          title="Mission effort"
          placeholder="Select effort"
          skipFilter
          current={input.local.effort.current()}
          options={missionEffortOptions.map((item) => ({
            title: item.title,
            value: item.value,
            description: item.description,
          }))}
          onSelect={(option) => {
            input.local.effort.set(option.value)
            resolve(option.value)
            input.dialog.clear()
          }}
        />
      ),
      () => resolve(undefined),
    )
  })
  if (!effort) return
  try {
    const session = (
      await input.sdk.client.session.create({ title: text.slice(0, 80) || "Mission" }, { throwOnError: true })
    ).data
    const intent = (await input.sdk.client.coordinator.intent.settle({ goal: text }, { throwOnError: true })).data
    const plan = (
      await input.sdk.client.coordinator.plan2.generate(
        { goal: text, intent, effort, workflow: intent.workflow },
        { throwOnError: true },
      )
    ).data
    const run = (
      await input.sdk.client.coordinator.run(
        {
          sessionID: session.id,
          goal: text,
          intent,
          effort,
          workflow: intent.workflow,
          mode: intent.risk_level === "high" ? "assisted" : "autonomous",
          nodes: plan.nodes,
        },
        { throwOnError: true },
      )
    ).data
    input.route.navigate({
      type: "mission",
      sessionID: session.id,
      runID: run.id,
    })
  } catch (error) {
    input.toast.error(error)
  }
}
