import { createMemo, type Component, type JSX } from "solid-js"
import { Select } from "@openagt/ui/select"
import { Switch } from "@openagt/ui/switch"
import { showToast } from "@openagt/ui/toast"
import type { Config } from "@openagt/sdk/v2/client"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
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
  const globalSync = useGlobalSync()
  const sandbox = createMemo(() => globalSync.data.config.experimental?.sandbox ?? {})

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
