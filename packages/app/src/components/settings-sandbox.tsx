import { createMemo, createResource, For, Show, type Component, type JSX } from "solid-js"
import { Button } from "@openagt/ui/button"
import { Select } from "@openagt/ui/select"
import { Switch } from "@openagt/ui/switch"
import { showToast } from "@openagt/ui/toast"
import type { Config, SandboxStatus } from "@openagt/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { defaultOnBlockerLabels } from "./settings-sandbox-helpers"
import { SettingsList } from "./settings-list"

type SandboxConfig = NonNullable<NonNullable<Config["experimental"]>["sandbox"]>
type SandboxBackend = NonNullable<SandboxConfig["backend"]>
type SandboxFailurePolicy = NonNullable<SandboxConfig["failure_policy"]>
type SandboxAclMode = NonNullable<SandboxConfig["windows_acl_apply_mode"]>

const backendOptions: Array<{ value: SandboxBackend; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "windows_native", label: "Windows native" },
  { value: "process", label: "Process" },
  { value: "seatbelt", label: "macOS Seatbelt" },
  { value: "landlock", label: "Linux Landlock" },
]

const failurePolicyOptions: Array<{ value: SandboxFailurePolicy; label: string }> = [
  { value: "fallback", label: "Fallback" },
  { value: "confirm_downgrade", label: "Confirm downgrade" },
  { value: "closed", label: "Closed" },
]

const aclModeOptions: Array<{ value: SandboxAclMode; label: string }> = [
  { value: "preflight", label: "Preflight" },
  { value: "dry_run", label: "Dry run" },
  { value: "apply", label: "Apply" },
]

export const SettingsSandbox: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const sandbox = createMemo(() => globalSync.data.config.experimental?.sandbox ?? {})
  const sandboxStatusKey = createMemo(() => JSON.stringify(sandbox()))
  const [sandboxStatus, sandboxStatusActions] = createResource(sandboxStatusKey, async () => {
    const response = await globalSDK.client.global.sandbox.status()
    return response.data
  })

  const updateSandbox = (patch: SandboxConfig) => {
    const before = globalSync.data.config
    const next = {
      ...before,
      experimental: {
        ...before.experimental,
        sandbox: {
          ...before.experimental?.sandbox,
          ...patch,
        },
      },
    } satisfies Config
    globalSync.set("config", next)
    void globalSync.updateConfig({ experimental: { sandbox: next.experimental.sandbox } }).catch((err: unknown) => {
      globalSync.set("config", before)
      showToast({
        title: language.t("settings.sandbox.toast.updateFailed.title"),
        description: err instanceof Error ? err.message : String(err),
      })
    })
  }

  const currentBackend = createMemo(
    () => backendOptions.find((item) => item.value === (sandbox().backend ?? "auto")) ?? backendOptions[0],
  )
  const currentFailurePolicy = createMemo(
    () =>
      failurePolicyOptions.find((item) => item.value === (sandbox().failure_policy ?? "fallback")) ??
      failurePolicyOptions[0],
  )
  const currentAclMode = createMemo(
    () =>
      aclModeOptions.find((item) => item.value === (sandbox().windows_acl_apply_mode ?? "preflight")) ??
      aclModeOptions[0],
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.sandbox.title")}</h2>
          <p class="text-12-regular text-text-weak">{language.t("settings.sandbox.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between gap-3 pb-2">
            <h3 class="text-14-medium text-text-strong">Status</h3>
            <Button
              size="small"
              variant="secondary"
              disabled={sandboxStatus.loading}
              onClick={() => sandboxStatusActions.refetch()}
            >
              Refresh status
            </Button>
          </div>
          <SettingsList>
            <SandboxStatusPanel status={sandboxStatus()} loading={sandboxStatus.loading} />
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.sandbox.section.runtime")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.sandbox.row.enabled.title")}
              description={language.t("settings.sandbox.row.enabled.description")}
            >
              <div data-action="settings-sandbox-enabled">
                <Switch checked={sandbox().enabled ?? true} onChange={(enabled) => updateSandbox({ enabled })} />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.sandbox.row.backend.title")}
              description={language.t("settings.sandbox.row.backend.description")}
            >
              <Select
                data-action="settings-sandbox-backend"
                options={backendOptions}
                current={currentBackend()}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && updateSandbox({ backend: item.value })}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "220px" }}
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.sandbox.row.failurePolicy.title")}
              description={language.t("settings.sandbox.row.failurePolicy.description")}
            >
              <Select
                data-action="settings-sandbox-failure-policy"
                options={failurePolicyOptions}
                current={currentFailurePolicy()}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && updateSandbox({ failure_policy: item.value })}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "220px" }}
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.sandbox.row.reportOnly.title")}
              description={language.t("settings.sandbox.row.reportOnly.description")}
            >
              <div data-action="settings-sandbox-report-only">
                <Switch
                  checked={sandbox().report_only ?? false}
                  onChange={(report_only) => updateSandbox({ report_only })}
                />
              </div>
            </SettingsRow>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.sandbox.section.windows")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.sandbox.row.aclMode.title")}
              description={language.t("settings.sandbox.row.aclMode.description")}
            >
              <Select
                data-action="settings-sandbox-acl-mode"
                options={aclModeOptions}
                current={currentAclMode()}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && updateSandbox({ windows_acl_apply_mode: item.value })}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "220px" }}
              />
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </div>
  )
}

const SandboxStatusPanel: Component<{
  status: SandboxStatus | undefined
  loading: boolean
}> = (props) => {
  const details = createMemo(() => {
    const status = props.status
    if (!status) return [] as Array<{ label: string; value: string }>
    return [
      {
        label: "Backend",
        value: `${status.preferred_backend} (${status.backend_run_loop_enabled ? "enabled" : "not ready"})`,
      },
      { label: "Native ready", value: flag(status.native_sandbox_ready) },
      { label: "Ready for default-on", value: flag(status.ready_for_default_on) },
      { label: "Default-on enabled", value: flag(status.default_on_enabled) },
      { label: "Helper", value: status.helper_path ?? "not found" },
      { label: "Version", value: status.windows_native.helper_version ?? "unknown" },
      {
        label: "Protocol",
        value: `${status.windows_native.helper_protocol_version ?? "unknown"} / required ${status.helper_protocol_required}`,
      },
      { label: "SHA256", value: status.windows_native.helper_sha256 ?? "unknown" },
      {
        label: "Setup",
        value:
          status.windows_native.setup_installed === undefined
            ? "unknown"
            : status.windows_native.setup_installed
              ? "installed"
              : "missing",
      },
      { label: "Admin gate", value: status.windows_native.admin_verification_required ? "required" : "not required" },
      {
        label: "Filesystem",
        value: `${flag(status.windows_native.filesystem_ready)} ready / ${flag(status.windows_native.filesystem_enforced)} enforced`,
      },
      { label: "ACL mode", value: status.config.windows_acl_apply_mode },
      { label: "ACL verified", value: flag(status.acl_apply_verified) },
      { label: "Admin report valid", value: flag(status.admin_gate_report_valid) },
      {
        label: "Network",
        value: `${flag(status.windows_native.network_ready)} ready / ${flag(status.windows_native.network_enforced)} enforced`,
      },
      {
        label: "Policies",
        value: status.windows_native.network_policies_enforced?.length
          ? status.windows_native.network_policies_enforced.join(", ")
          : "none",
      },
    ]
  })

  return (
    <div class="py-3">
      <Show
        when={props.status}
        fallback={
          <span class="text-12-regular text-text-weak">
            {props.loading ? "Loading sandbox status..." : "Sandbox status unavailable."}
          </span>
        }
      >
        {(status) => (
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex items-center gap-2">
                  <StatusBadge status={status().windows_native.readiness ?? "backend_unavailable"} />
                  <span class="text-12-regular text-text-weak">
                    {status().windows_native.reason ?? status().next_action.label}
                  </span>
                </div>
                <Show when={status().windows_native.admin_gate_report_path}>
                  <span class="text-11-regular text-text-weak break-all">
                    Admin report: {status().windows_native.admin_gate_report_path}
                  </span>
                </Show>
                <Show when={status().windows_native.admin_gate_verified_at}>
                  <span class="text-11-regular text-text-weak">
                    Verified at: {status().windows_native.admin_gate_verified_at}
                  </span>
                </Show>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <For each={details()}>
                {(item) => (
                  <div class="min-w-0 rounded-md bg-surface-panel px-3 py-2">
                    <div class="text-11-medium text-text-weak">{item.label}</div>
                    <div class="truncate text-12-regular text-text-strong" title={item.value}>
                      {item.value}
                    </div>
                  </div>
                )}
              </For>
            </div>

            <div class="rounded-md border border-border-weak-base bg-surface-panel px-3 py-2">
              <div class="text-11-medium text-text-weak">Default-on blockers</div>
              <Show
                when={status().default_on_blockers.length > 0}
                fallback={<div class="text-12-regular text-text-strong">None</div>}
              >
                <ul class="mt-1 flex list-disc flex-col gap-1 pl-4 text-12-regular text-text-strong">
                  <For each={defaultOnBlockerLabels(status())}>{(item) => <li>{item}</li>}</For>
                </ul>
              </Show>
              <div class="mt-2 text-11-regular text-text-weak">
                network_policy=loopback remains unsupported in this milestone.
              </div>
            </div>

            <div class="rounded-md border border-border-weak-base bg-surface-panel px-3 py-2">
              <div class="text-11-medium text-text-weak">Next action</div>
              <div class="text-12-regular text-text-strong">{status().next_action.label}</div>
              <Show when={status().next_action.command}>
                <code class="mt-1 block overflow-x-auto whitespace-nowrap text-11-regular text-text-weak">
                  {status().next_action.command}
                </code>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

const StatusBadge: Component<{ status: string }> = (props) => {
  const ready = createMemo(() => props.status === "ready")
  return (
    <span
      classList={{
        "rounded-full px-2 py-0.5 text-11-medium": true,
        "bg-surface-success-weak text-text-on-success-strong": ready(),
        "bg-surface-warning-weak text-text-on-warning-strong": !ready(),
      }}
    >
      {props.status}
    </span>
  )
}

function flag(value: boolean | undefined) {
  if (value === undefined) return "unknown"
  return value ? "yes" : "no"
}

const SettingsRow: Component<{
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
