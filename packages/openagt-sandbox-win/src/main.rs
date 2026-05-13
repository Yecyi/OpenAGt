use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{self, Read};
#[cfg(not(windows))]
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const HELPER_PROTOCOL_VERSION: u32 = 1;
const SETUP_VERSION: &str = "1";
const ACL_APPLY_MODE_ENV: &str = "OPENAGT_SANDBOX_WINDOWS_APPLY_ACL";
const ADMIN_GATE_REPORT_ENV: &str = "OPENAGT_SANDBOX_WINDOWS_ADMIN_GATE_REPORT";
const SETUP_PROVIDER_DATA: &[u8] = b"openagt-windows-sandbox-setup-v1";

#[cfg(windows)]
const OPENAGT_WFP_PROVIDER_KEY: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0x4a9b3b8a_2d85_4d24_9b2d_80f1f14f82a1);
#[cfg(windows)]
const OPENAGT_WFP_SUBLAYER_KEY: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0x6ac6d548_a75e_45f1_9dfd_9e4af422edaf);
#[cfg(windows)]
const OPENAGT_WFP_OUTBOUND_V4_FILTER_KEY: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0x7a2868b1_6e82_4640_9be5_b6d90c2a6e4d);
#[cfg(windows)]
const OPENAGT_WFP_OUTBOUND_V6_FILTER_KEY: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0x94100b26_8d7d_4c2a_9aef_7e415a98de77);
#[cfg(windows)]
const OPENAGT_WFP_INBOUND_V4_FILTER_KEY: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0x2d933b33_4f21_4790_8506_676e8c55d8df);
#[cfg(windows)]
const OPENAGT_WFP_INBOUND_V6_FILTER_KEY: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0xaaa2eb49_c0dc_4c43_97d7_269c50fc9717);

#[cfg(windows)]
#[derive(Clone, Copy)]
struct WfpFilterSpec {
    key: windows_sys::core::GUID,
    layer: windows_sys::core::GUID,
    description: &'static str,
}

#[derive(Debug, Deserialize)]
struct ExecRequest {
    request_id: String,
    command: String,
    shell_family: String,
    shell: String,
    cwd: String,
    timeout_ms: u64,
    env: BTreeMap<String, String>,
    enforcement: String,
    backend_preference: String,
    filesystem_policy: String,
    allowed_paths: Vec<String>,
    writable_paths: Vec<String>,
    network_policy: String,
}

#[derive(Debug, Serialize)]
struct ProbeOutput {
    helper_version: String,
    helper_protocol_version: u32,
    helper_path: Option<String>,
    helper_sha256: Option<String>,
    windows_build: Option<String>,
    readiness: String,
    acl_apply_mode: String,
    elevated: bool,
    restricted_token_supported: bool,
    job_object_supported: bool,
    wfp_supported: bool,
    setup_installed: bool,
    setup_version: String,
    setup_required: bool,
    setup_reason: Option<String>,
    filesystem_ready: bool,
    filesystem_enforced: bool,
    filesystem_reason: Option<String>,
    network_ready: bool,
    network_enforced: bool,
    network_reason: Option<String>,
    network_policies_enforced: Vec<String>,
    admin_verification_required: bool,
    admin_gate_report_path: Option<String>,
    admin_gate_verified_at: Option<String>,
    capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
struct SetupOutput {
    ok: bool,
    mode: String,
    readiness: String,
    setup_installed: bool,
    setup_version: String,
    setup_required: bool,
    setup_reason: Option<String>,
    elevated: bool,
    restricted_token_supported: bool,
    job_object_supported: bool,
    wfp_supported: bool,
    filesystem_ready: bool,
    filesystem_enforced: bool,
    filesystem_reason: Option<String>,
    network_ready: bool,
    network_enforced: bool,
    network_reason: Option<String>,
    network_policies_enforced: Vec<String>,
    admin_verification_required: bool,
    admin_gate_report_path: Option<String>,
    admin_gate_verified_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct ExecOutput {
    request_id: String,
    exit_code: Option<i32>,
    termination_reason: String,
    backend_used: String,
    stdout_tail: String,
    stderr_tail: String,
    policy_advisory: PolicyAdvisory,
}

#[derive(Debug, Serialize)]
struct PolicyAdvisory {
    enforcement: String,
    #[serde(rename = "backendPreference")]
    backend_preference: String,
    #[serde(rename = "filesystemPolicy")]
    filesystem_policy: String,
    #[serde(rename = "networkPolicy")]
    network_policy: String,
    #[serde(rename = "allowedPaths")]
    allowed_paths: Vec<String>,
    #[serde(rename = "writablePaths")]
    writable_paths: Vec<String>,
    #[serde(rename = "reportOnly")]
    report_only: bool,
    enforced: bool,
    #[serde(rename = "filesystemEnforced")]
    filesystem_enforced: bool,
    #[serde(rename = "networkEnforced")]
    network_enforced: bool,
    #[serde(rename = "windowsSandboxMode")]
    windows_sandbox_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FilesystemGrantPlan {
    read_paths: Vec<String>,
    writable_paths: Vec<String>,
    deny_write_paths: Vec<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
enum FilesystemAclAccess {
    DenyWrite,
    AllowRead,
    AllowWrite,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct FilesystemAclEntry {
    path: String,
    principal_sid: String,
    access: FilesystemAclAccess,
    inherit_children: bool,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct FilesystemAclTransaction {
    principal_sid: String,
    backup_paths: Vec<String>,
    entries: Vec<FilesystemAclEntry>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct AclBackupEntry {
    path: String,
    sddl: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct AclBackup {
    entries: Vec<AclBackupEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FilesystemAclApplyMode {
    Preflight,
    DryRun,
    Apply,
}

struct AppliedAclGuard {
    backup: Option<AclBackup>,
}

impl AppliedAclGuard {
    fn finish(mut self) -> Result<(), String> {
        if let Some(backup) = self.backup.take() {
            return rollback_acl(&backup);
        }
        Ok(())
    }
}

impl Drop for AppliedAclGuard {
    fn drop(&mut self) {
        if let Some(backup) = self.backup.take() {
            let _ = rollback_acl(&backup);
        }
    }
}

fn print_json<T: Serialize>(value: &T) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(value).map_err(|error| error.to_string())?
    );
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WfpSetupState {
    engine_available: bool,
    provider_installed: bool,
    sublayer_installed: bool,
    outbound_v4_filter_installed: bool,
    outbound_v6_filter_installed: bool,
    inbound_v4_filter_installed: bool,
    inbound_v6_filter_installed: bool,
    setup_version: String,
    reason: Option<String>,
}

impl WfpSetupState {
    fn installed(&self) -> bool {
        self.engine_available
            && self.provider_installed
            && self.sublayer_installed
            && self.outbound_v4_filter_installed
            && self.outbound_v6_filter_installed
            && self.inbound_v4_filter_installed
            && self.inbound_v6_filter_installed
            && self.setup_version == SETUP_VERSION
    }

    fn setup_required(&self) -> bool {
        !self.installed()
    }

    fn network_reason(&self) -> Option<String> {
        if self.installed() {
            return None;
        }
        self.reason.clone().or_else(|| {
            Some(
                "Windows WFP setup is not installed or does not match this helper version"
                    .to_string(),
            )
        })
    }

    fn enforced_policies(&self) -> Vec<String> {
        if self.installed() {
            return vec!["none".to_string()];
        }
        Vec::new()
    }
}

fn filesystem_status(restricted_token_supported: bool) -> (bool, bool, Option<String>) {
    if !restricted_token_supported {
        return (
            false,
            false,
            Some(
                "Restricted token launch privilege is not available in this helper process"
                    .to_string(),
            ),
        );
    }
    if acl_apply_mode_from_env() == FilesystemAclApplyMode::Apply {
        return (true, true, None);
    }
    (
        true,
        false,
        Some(
            "Filesystem ACL enforcement is available only when OPENAGT_SANDBOX_WINDOWS_APPLY_ACL=apply is explicitly set"
                .to_string(),
        ),
    )
}

fn acl_apply_mode_label() -> &'static str {
    match acl_apply_mode_from_env() {
        FilesystemAclApplyMode::Preflight => "preflight",
        FilesystemAclApplyMode::DryRun => "dry_run",
        FilesystemAclApplyMode::Apply => "apply",
    }
}

fn helper_path() -> Option<String> {
    std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
}

fn helper_sha256() -> Option<String> {
    let bytes = std::fs::read(std::env::current_exe().ok()?).ok()?;
    Some(
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>(),
    )
}

fn admin_gate_report_path() -> Option<String> {
    if let Ok(path) = std::env::var(ADMIN_GATE_REPORT_ENV) {
        return (!path.trim().is_empty()).then_some(path);
    }
    std::env::current_dir().ok().map(|cwd| {
        cwd.join(".artifacts")
            .join("windows-sandbox")
            .join("admin-gate-report.json")
            .to_string_lossy()
            .to_string()
    })
}

fn admin_gate_verified_at(path: Option<&str>) -> Option<String> {
    let path = path?;
    let text = std::fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    if value.get("schema_version").and_then(|item| item.as_u64()) != Some(1) {
        return None;
    }
    if value.get("gate").and_then(|item| item.as_str()) != Some("windows_sandbox_admin_execution") {
        return None;
    }
    if value.get("status").and_then(|item| item.as_str()) != Some("passed") {
        return None;
    }
    match value.get("results").and_then(|item| item.as_array()) {
        Some(items) if !items.is_empty() => {}
        _ => return None,
    }
    value
        .get("generated_at")
        .and_then(|item| item.as_str())
        .map(str::to_string)
}

fn native_readiness(
    restricted_token_supported: bool,
    filesystem_enforced: bool,
    wfp: &WfpSetupState,
    admin_verified: bool,
) -> &'static str {
    if !cfg!(windows) || !restricted_token_supported {
        return "backend_unavailable";
    }
    if !filesystem_enforced {
        return "acl_apply_required";
    }
    if wfp.setup_required() {
        return "setup_required";
    }
    if !admin_verified {
        return "admin_verification_required";
    }
    "ready"
}

fn probe() -> ProbeOutput {
    let restricted_token_supported = restricted_token_launch_supported();
    let (filesystem_ready, filesystem_enforced, filesystem_reason) =
        filesystem_status(restricted_token_supported);
    let wfp = wfp_setup_state();
    let setup_reason = wfp.network_reason();
    let admin_gate_report_path = admin_gate_report_path();
    let admin_gate_verified_at = admin_gate_verified_at(admin_gate_report_path.as_deref());
    let admin_verification_required = wfp.installed() && admin_gate_verified_at.is_none();
    let capabilities = [
        Some("probe".to_string()),
        Some("exec".to_string()),
        cfg!(windows).then(|| "job-object".to_string()),
        Some("path-preflight".to_string()),
        restricted_token_supported.then(|| "restricted-token".to_string()),
        filesystem_enforced.then(|| "filesystem-acl-enforcement".to_string()),
        wfp.installed().then(|| "wfp-network-none".to_string()),
        Some("setup-status".to_string()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    ProbeOutput {
        helper_version: env!("CARGO_PKG_VERSION").to_string(),
        helper_protocol_version: HELPER_PROTOCOL_VERSION,
        helper_path: helper_path(),
        helper_sha256: helper_sha256(),
        windows_build: windows_build(),
        readiness: native_readiness(
            restricted_token_supported,
            filesystem_enforced,
            &wfp,
            admin_gate_verified_at.is_some(),
        )
        .to_string(),
        acl_apply_mode: acl_apply_mode_label().to_string(),
        elevated: process_is_elevated(),
        restricted_token_supported,
        job_object_supported: cfg!(windows),
        wfp_supported: cfg!(windows),
        setup_installed: wfp.installed(),
        setup_version: wfp.setup_version.clone(),
        setup_required: wfp.setup_required(),
        setup_reason,
        filesystem_ready,
        filesystem_enforced,
        filesystem_reason,
        network_ready: wfp.engine_available,
        network_enforced: wfp.installed(),
        network_reason: wfp.network_reason(),
        network_policies_enforced: wfp.enforced_policies(),
        admin_verification_required,
        admin_gate_report_path,
        admin_gate_verified_at,
        capabilities,
    }
}

fn setup(mode: &str) -> SetupOutput {
    let action = match mode {
        "install" => install_wfp_setup(),
        "uninstall" => uninstall_wfp_setup(),
        "status" => Ok(()),
        _ => Err("Unknown Windows sandbox setup mode".to_string()),
    };
    let action_ok = action.is_ok();
    let action_error = action.err();
    let status = probe();
    let setup_reason = action_error.or(status.setup_reason);
    let ok = action_ok
        && (mode == "status"
            || (mode == "install" && status.setup_installed)
            || mode == "uninstall");
    SetupOutput {
        ok,
        mode: mode.to_string(),
        readiness: status.readiness,
        setup_installed: status.setup_installed,
        setup_version: status.setup_version,
        setup_required: status.setup_required,
        setup_reason,
        elevated: status.elevated,
        restricted_token_supported: status.restricted_token_supported,
        job_object_supported: status.job_object_supported,
        wfp_supported: status.wfp_supported,
        filesystem_ready: status.filesystem_ready,
        filesystem_enforced: status.filesystem_enforced,
        filesystem_reason: status.filesystem_reason,
        network_ready: status.network_ready,
        network_enforced: status.network_enforced,
        network_reason: status.network_reason,
        network_policies_enforced: status.network_policies_enforced,
        admin_verification_required: status.admin_verification_required,
        admin_gate_report_path: status.admin_gate_report_path,
        admin_gate_verified_at: status.admin_gate_verified_at,
    }
}

#[cfg(not(windows))]
fn wfp_setup_state() -> WfpSetupState {
    WfpSetupState {
        engine_available: false,
        provider_installed: false,
        sublayer_installed: false,
        outbound_v4_filter_installed: false,
        outbound_v6_filter_installed: false,
        inbound_v4_filter_installed: false,
        inbound_v6_filter_installed: false,
        setup_version: "0".to_string(),
        reason: Some("Windows Filtering Platform is only available on Windows".to_string()),
    }
}

#[cfg(not(windows))]
fn install_wfp_setup() -> Result<(), String> {
    Err("Windows WFP setup install is only available on Windows".to_string())
}

#[cfg(not(windows))]
fn uninstall_wfp_setup() -> Result<(), String> {
    Err("Windows WFP setup uninstall is only available on Windows".to_string())
}

#[cfg(windows)]
fn wfp_setup_state() -> WfpSetupState {
    match query_wfp_setup_state() {
        Ok(state) => state,
        Err(error) => WfpSetupState {
            engine_available: false,
            provider_installed: false,
            sublayer_installed: false,
            outbound_v4_filter_installed: false,
            outbound_v6_filter_installed: false,
            inbound_v4_filter_installed: false,
            inbound_v6_filter_installed: false,
            setup_version: "0".to_string(),
            reason: Some(error),
        },
    }
}

#[cfg(windows)]
fn wfp_filter_specs() -> [WfpFilterSpec; 4] {
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
        FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWPM_LAYER_ALE_AUTH_CONNECT_V6,
        FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4, FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
    };

    [
        WfpFilterSpec {
            key: OPENAGT_WFP_OUTBOUND_V4_FILTER_KEY,
            layer: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            description: "OpenAGt block outbound IPv4",
        },
        WfpFilterSpec {
            key: OPENAGT_WFP_OUTBOUND_V6_FILTER_KEY,
            layer: FWPM_LAYER_ALE_AUTH_CONNECT_V6,
            description: "OpenAGt block outbound IPv6",
        },
        WfpFilterSpec {
            key: OPENAGT_WFP_INBOUND_V4_FILTER_KEY,
            layer: FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4,
            description: "OpenAGt block inbound IPv4",
        },
        WfpFilterSpec {
            key: OPENAGT_WFP_INBOUND_V6_FILTER_KEY,
            layer: FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
            description: "OpenAGt block inbound IPv6",
        },
    ]
}

#[cfg(windows)]
struct WfpEngine(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for WfpEngine {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FwpmEngineClose0(
                self.0,
            );
        }
    }
}

#[cfg(windows)]
fn open_wfp_engine() -> Result<WfpEngine, String> {
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FwpmEngineOpen0;
    use windows_sys::Win32::System::Rpc::RPC_C_AUTHN_WINNT;

    unsafe {
        let mut engine = 0;
        let result = FwpmEngineOpen0(
            std::ptr::null(),
            RPC_C_AUTHN_WINNT,
            std::ptr::null(),
            std::ptr::null(),
            &mut engine,
        );
        if result != 0 {
            return Err(format!("FwpmEngineOpen0 failed: {result}"));
        }
        Ok(WfpEngine(engine))
    }
}

#[cfg(windows)]
fn query_wfp_setup_state() -> Result<WfpSetupState, String> {
    let engine = open_wfp_engine()?;
    let provider = wfp_provider_status(&engine)?;
    let sublayer_installed = wfp_sublayer_installed(&engine)?;
    let outbound_v4_filter_installed =
        wfp_filter_installed(&engine, &OPENAGT_WFP_OUTBOUND_V4_FILTER_KEY)?;
    let outbound_v6_filter_installed =
        wfp_filter_installed(&engine, &OPENAGT_WFP_OUTBOUND_V6_FILTER_KEY)?;
    let inbound_v4_filter_installed =
        wfp_filter_installed(&engine, &OPENAGT_WFP_INBOUND_V4_FILTER_KEY)?;
    let inbound_v6_filter_installed =
        wfp_filter_installed(&engine, &OPENAGT_WFP_INBOUND_V6_FILTER_KEY)?;
    let state = WfpSetupState {
        engine_available: true,
        provider_installed: provider.0,
        sublayer_installed,
        outbound_v4_filter_installed,
        outbound_v6_filter_installed,
        inbound_v4_filter_installed,
        inbound_v6_filter_installed,
        setup_version: provider.1,
        reason: None,
    };
    if state.installed() {
        return Ok(state);
    }
    Ok(WfpSetupState {
        reason: Some(wfp_missing_reason(&state)),
        ..state
    })
}

#[cfg(windows)]
fn wfp_missing_reason(state: &WfpSetupState) -> String {
    let missing = [
        (!state.provider_installed).then_some("provider"),
        (!state.sublayer_installed).then_some("sublayer"),
        (!state.outbound_v4_filter_installed).then_some("outbound_v4_filter"),
        (!state.outbound_v6_filter_installed).then_some("outbound_v6_filter"),
        (!state.inbound_v4_filter_installed).then_some("inbound_v4_filter"),
        (!state.inbound_v6_filter_installed).then_some("inbound_v6_filter"),
        (state.setup_version != SETUP_VERSION).then_some("version"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    format!(
        "Windows WFP setup is incomplete or stale: {}",
        missing.join(", ")
    )
}

#[cfg(windows)]
fn install_wfp_setup() -> Result<(), String> {
    if !process_is_elevated() {
        return Err(
            "Windows WFP setup install requires an elevated Administrator terminal".to_string(),
        );
    }
    let engine = open_wfp_engine()?;
    wfp_transaction(&engine, || {
        remove_wfp_setup_objects(&engine)?;
        add_wfp_provider(&engine)?;
        add_wfp_sublayer(&engine)?;
        for spec in wfp_filter_specs() {
            add_wfp_filter(&engine, spec)?;
        }
        Ok(())
    })
}

#[cfg(windows)]
fn uninstall_wfp_setup() -> Result<(), String> {
    if !process_is_elevated() {
        return Err(
            "Windows WFP setup uninstall requires an elevated Administrator terminal".to_string(),
        );
    }
    let engine = open_wfp_engine()?;
    wfp_transaction(&engine, || remove_wfp_setup_objects(&engine))
}

#[cfg(windows)]
fn wfp_transaction<F>(engine: &WfpEngine, body: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
        FwpmTransactionAbort0, FwpmTransactionBegin0, FwpmTransactionCommit0,
    };

    unsafe {
        let begin = FwpmTransactionBegin0(engine.0, 0);
        if begin != 0 {
            return Err(format!("FwpmTransactionBegin0 failed: {begin}"));
        }
        match body() {
            Ok(()) => {
                let commit = FwpmTransactionCommit0(engine.0);
                if commit != 0 {
                    return Err(format!("FwpmTransactionCommit0 failed: {commit}"));
                }
                Ok(())
            }
            Err(error) => {
                FwpmTransactionAbort0(engine.0);
                Err(error)
            }
        }
    }
}

#[cfg(windows)]
fn is_wfp_missing(result: u32) -> bool {
    use windows_sys::Win32::Foundation::{
        FWP_E_FILTER_NOT_FOUND, FWP_E_NOT_FOUND, FWP_E_PROVIDER_NOT_FOUND, FWP_E_SUBLAYER_NOT_FOUND,
    };
    matches!(
        result as i32,
        FWP_E_NOT_FOUND
            | FWP_E_PROVIDER_NOT_FOUND
            | FWP_E_SUBLAYER_NOT_FOUND
            | FWP_E_FILTER_NOT_FOUND
    )
}

#[cfg(windows)]
fn wfp_provider_status(engine: &WfpEngine) -> Result<(bool, String), String> {
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
        FwpmFreeMemory0, FwpmProviderGetByKey0, FWPM_PROVIDER0,
    };

    unsafe {
        let mut provider: *mut FWPM_PROVIDER0 = std::ptr::null_mut();
        let result = FwpmProviderGetByKey0(engine.0, &OPENAGT_WFP_PROVIDER_KEY, &mut provider);
        if is_wfp_missing(result) {
            return Ok((false, "0".to_string()));
        }
        if result != 0 {
            return Err(format!("FwpmProviderGetByKey0 failed: {result}"));
        }
        let setup_version = if provider.is_null() || (*provider).providerData.data.is_null() {
            "0".to_string()
        } else {
            let bytes = std::slice::from_raw_parts(
                (*provider).providerData.data,
                (*provider).providerData.size as usize,
            );
            if bytes == SETUP_PROVIDER_DATA {
                SETUP_VERSION.to_string()
            } else {
                "stale".to_string()
            }
        };
        FwpmFreeMemory0(&mut provider as *mut _ as *mut _);
        Ok((true, setup_version))
    }
}

#[cfg(windows)]
fn wfp_sublayer_installed(engine: &WfpEngine) -> Result<bool, String> {
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
        FwpmFreeMemory0, FwpmSubLayerGetByKey0, FWPM_SUBLAYER0,
    };

    unsafe {
        let mut sublayer: *mut FWPM_SUBLAYER0 = std::ptr::null_mut();
        let result = FwpmSubLayerGetByKey0(engine.0, &OPENAGT_WFP_SUBLAYER_KEY, &mut sublayer);
        if is_wfp_missing(result) {
            return Ok(false);
        }
        if result != 0 {
            return Err(format!("FwpmSubLayerGetByKey0 failed: {result}"));
        }
        FwpmFreeMemory0(&mut sublayer as *mut _ as *mut _);
        Ok(true)
    }
}

#[cfg(windows)]
fn wfp_filter_installed(engine: &WfpEngine, key: &windows_sys::core::GUID) -> Result<bool, String> {
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
        FwpmFilterGetByKey0, FwpmFreeMemory0, FWPM_FILTER0,
    };

    unsafe {
        let mut filter: *mut FWPM_FILTER0 = std::ptr::null_mut();
        let result = FwpmFilterGetByKey0(engine.0, key, &mut filter);
        if is_wfp_missing(result) {
            return Ok(false);
        }
        if result != 0 {
            return Err(format!("FwpmFilterGetByKey0 failed: {result}"));
        }
        FwpmFreeMemory0(&mut filter as *mut _ as *mut _);
        Ok(true)
    }
}

#[cfg(windows)]
fn remove_wfp_setup_objects(engine: &WfpEngine) -> Result<(), String> {
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
        FwpmFilterDeleteByKey0, FwpmProviderDeleteByKey0, FwpmSubLayerDeleteByKey0,
    };

    unsafe {
        for spec in wfp_filter_specs() {
            let result = FwpmFilterDeleteByKey0(engine.0, &spec.key);
            if result != 0 && !is_wfp_missing(result) {
                return Err(format!("FwpmFilterDeleteByKey0 failed: {result}"));
            }
        }
        let sublayer = FwpmSubLayerDeleteByKey0(engine.0, &OPENAGT_WFP_SUBLAYER_KEY);
        if sublayer != 0 && !is_wfp_missing(sublayer) {
            return Err(format!("FwpmSubLayerDeleteByKey0 failed: {sublayer}"));
        }
        let provider = FwpmProviderDeleteByKey0(engine.0, &OPENAGT_WFP_PROVIDER_KEY);
        if provider != 0 && !is_wfp_missing(provider) {
            return Err(format!("FwpmProviderDeleteByKey0 failed: {provider}"));
        }
        Ok(())
    }
}

#[cfg(windows)]
fn add_wfp_provider(engine: &WfpEngine) -> Result<(), String> {
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
        FwpmProviderAdd0, FWPM_DISPLAY_DATA0, FWPM_PROVIDER0, FWP_BYTE_BLOB,
    };

    let mut name = wide_null("OpenAGt Windows Sandbox");
    let mut description = wide_null("OpenAGt native Windows sandbox WFP provider");
    let mut provider_data = SETUP_PROVIDER_DATA.to_vec();
    let provider = FWPM_PROVIDER0 {
        providerKey: OPENAGT_WFP_PROVIDER_KEY,
        displayData: FWPM_DISPLAY_DATA0 {
            name: name.as_mut_ptr(),
            description: description.as_mut_ptr(),
        },
        flags: 0,
        providerData: FWP_BYTE_BLOB {
            size: provider_data.len() as u32,
            data: provider_data.as_mut_ptr(),
        },
        serviceName: std::ptr::null_mut(),
    };
    unsafe {
        let result = FwpmProviderAdd0(engine.0, &provider, std::ptr::null_mut());
        if result != 0 {
            return Err(format!("FwpmProviderAdd0 failed: {result}"));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn add_wfp_sublayer(engine: &WfpEngine) -> Result<(), String> {
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
        FwpmSubLayerAdd0, FWPM_DISPLAY_DATA0, FWPM_SUBLAYER0, FWP_BYTE_BLOB,
    };

    let mut name = wide_null("OpenAGt Windows Sandbox");
    let mut description = wide_null("OpenAGt restricted-token network policy sublayer");
    let mut provider_key = OPENAGT_WFP_PROVIDER_KEY;
    let sublayer = FWPM_SUBLAYER0 {
        subLayerKey: OPENAGT_WFP_SUBLAYER_KEY,
        displayData: FWPM_DISPLAY_DATA0 {
            name: name.as_mut_ptr(),
            description: description.as_mut_ptr(),
        },
        flags: 0,
        providerKey: &mut provider_key,
        providerData: FWP_BYTE_BLOB {
            size: 0,
            data: std::ptr::null_mut(),
        },
        weight: 0x7fff,
    };
    unsafe {
        let result = FwpmSubLayerAdd0(engine.0, &sublayer, std::ptr::null_mut());
        if result != 0 {
            return Err(format!("FwpmSubLayerAdd0 failed: {result}"));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn add_wfp_filter(engine: &WfpEngine, spec: WfpFilterSpec) -> Result<(), String> {
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
        FwpmFilterAdd0, FWPM_ACTION0, FWPM_ACTION0_0, FWPM_CONDITION_ALE_USER_ID,
        FWPM_DISPLAY_DATA0, FWPM_FILTER0, FWPM_FILTER0_0, FWPM_FILTER_CONDITION0,
        FWPM_FILTER_FLAG_PERSISTENT, FWP_ACTION_BLOCK, FWP_BYTE_BLOB, FWP_CONDITION_VALUE0,
        FWP_CONDITION_VALUE0_0, FWP_MATCH_EQUAL, FWP_SECURITY_DESCRIPTOR_TYPE, FWP_UINT8,
        FWP_VALUE0, FWP_VALUE0_0,
    };

    let mut name = wide_null(spec.description);
    let mut description =
        wide_null("Blocks network for OpenAGt restricted-token sandbox processes");
    let mut provider_key = OPENAGT_WFP_PROVIDER_KEY;
    let user_condition = WfpUserMatchCondition::for_restricted_code()?;
    let mut condition = FWPM_FILTER_CONDITION0 {
        fieldKey: FWPM_CONDITION_ALE_USER_ID,
        matchType: FWP_MATCH_EQUAL,
        conditionValue: FWP_CONDITION_VALUE0 {
            r#type: FWP_SECURITY_DESCRIPTOR_TYPE,
            Anonymous: FWP_CONDITION_VALUE0_0 {
                sd: &user_condition.blob as *const _ as *mut _,
            },
        },
    };
    let filter = FWPM_FILTER0 {
        filterKey: spec.key,
        displayData: FWPM_DISPLAY_DATA0 {
            name: name.as_mut_ptr(),
            description: description.as_mut_ptr(),
        },
        flags: FWPM_FILTER_FLAG_PERSISTENT,
        providerKey: &mut provider_key,
        providerData: FWP_BYTE_BLOB {
            size: 0,
            data: std::ptr::null_mut(),
        },
        layerKey: spec.layer,
        subLayerKey: OPENAGT_WFP_SUBLAYER_KEY,
        weight: FWP_VALUE0 {
            r#type: FWP_UINT8,
            Anonymous: FWP_VALUE0_0 { uint8: 15 },
        },
        numFilterConditions: 1,
        filterCondition: &mut condition,
        action: FWPM_ACTION0 {
            r#type: FWP_ACTION_BLOCK,
            Anonymous: unsafe { std::mem::zeroed::<FWPM_ACTION0_0>() },
        },
        Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
        reserved: std::ptr::null_mut(),
        filterId: 0,
        effectiveWeight: FWP_VALUE0 {
            r#type: FWP_UINT8,
            Anonymous: FWP_VALUE0_0 { uint8: 0 },
        },
    };
    unsafe {
        let mut id = 0;
        let result = FwpmFilterAdd0(engine.0, &filter, std::ptr::null_mut(), &mut id);
        if result != 0 {
            return Err(format!(
                "FwpmFilterAdd0 failed for {}: {result}",
                spec.description
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
struct WfpUserMatchCondition {
    security_descriptor: windows_sys::Win32::Security::PSECURITY_DESCRIPTOR,
    blob: windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWP_BYTE_BLOB,
}

#[cfg(windows)]
impl WfpUserMatchCondition {
    fn for_restricted_code() -> Result<Self, String> {
        use std::ptr::{null, null_mut};
        use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
        use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
            FWP_ACTRL_MATCH_FILTER, FWP_BYTE_BLOB,
        };
        use windows_sys::Win32::Security::Authorization::{
            BuildSecurityDescriptorW, EXPLICIT_ACCESS_W, GRANT_ACCESS, NO_MULTIPLE_TRUSTEE,
            TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
        };
        use windows_sys::Win32::Security::PSECURITY_DESCRIPTOR;

        let restricted_sid = restricted_code_sid()?;
        let access = EXPLICIT_ACCESS_W {
            grfAccessPermissions: FWP_ACTRL_MATCH_FILTER,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: 0,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: null_mut(),
                MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: restricted_sid.as_ptr() as *mut u16,
            },
        };

        let mut security_descriptor: PSECURITY_DESCRIPTOR = null_mut();
        let mut security_descriptor_len = 0;
        let result = unsafe {
            BuildSecurityDescriptorW(
                null(),
                null(),
                1,
                &access,
                0,
                null(),
                null_mut(),
                &mut security_descriptor_len,
                &mut security_descriptor,
            )
        };
        if result != 0 {
            unsafe {
                if !security_descriptor.is_null() {
                    LocalFree(security_descriptor as HLOCAL);
                }
            }
            return Err(format!("BuildSecurityDescriptorW failed: {result}"));
        }

        Ok(Self {
            security_descriptor,
            blob: FWP_BYTE_BLOB {
                size: security_descriptor_len,
                data: security_descriptor as *mut u8,
            },
        })
    }
}

#[cfg(windows)]
impl Drop for WfpUserMatchCondition {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};

        if !self.security_descriptor.is_null() {
            unsafe {
                LocalFree(self.security_descriptor as HLOCAL);
            }
        }
    }
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain([0]).collect()
}

fn protected_workspace_write_names() -> [&'static str; 5] {
    [".git", ".openagt", ".opencode", ".codex", ".agents"]
}

fn sort_dedup(mut input: Vec<String>) -> Vec<String> {
    input.sort();
    input.dedup();
    input
}

fn is_path_or_child(path: &str, parent: &str) -> bool {
    if path == parent {
        return true;
    }
    let parent = parent.trim_end_matches(['\\', '/']);
    path.starts_with(&format!("{parent}\\")) || path.starts_with(&format!("{parent}/"))
}

fn child_path(parent: &str, name: &str) -> String {
    format!("{}\\{}", parent.trim_end_matches(['\\', '/']), name)
}

fn filesystem_grant_plan(request: &ExecRequest) -> Result<FilesystemGrantPlan, String> {
    let cwd = canonicalize_sandbox_path("cwd", &request.cwd)?;
    let read_paths = sort_dedup(
        request
            .allowed_paths
            .iter()
            .map(|item| canonicalize_sandbox_path("allowed_path", item))
            .collect::<Result<Vec<_>, _>>()?,
    );
    let writable_paths = sort_dedup(
        request
            .writable_paths
            .iter()
            .map(|item| canonicalize_sandbox_path("writable_path", item))
            .collect::<Result<Vec<_>, _>>()?,
    );
    if request.filesystem_policy == "read_only" && !writable_paths.is_empty() {
        return Err("read_only filesystem policy cannot include writable_paths".to_string());
    }
    if let Some(path) = writable_paths.iter().find(|path| {
        !read_paths
            .iter()
            .any(|allowed| is_path_or_child(path, allowed))
    }) {
        return Err(format!("writable_path is not inside allowed_paths: {path}"));
    }
    let deny_write_paths = if request.filesystem_policy == "workspace_write" {
        protected_workspace_write_names()
            .into_iter()
            .map(|name| child_path(&cwd, name))
            .collect()
    } else {
        Vec::new()
    };
    Ok(FilesystemGrantPlan {
        read_paths,
        writable_paths,
        deny_write_paths,
    })
}

#[allow(dead_code)]
fn filesystem_acl_transaction(
    grant: &FilesystemGrantPlan,
    principal_sid: &str,
) -> Result<FilesystemAclTransaction, String> {
    if principal_sid.trim().is_empty() {
        return Err("ACL transaction requires a sandbox principal SID".to_string());
    }
    let backup_paths = sort_dedup(
        grant
            .deny_write_paths
            .iter()
            .chain(grant.read_paths.iter())
            .chain(grant.writable_paths.iter())
            .cloned()
            .collect(),
    );
    let entries = grant
        .deny_write_paths
        .iter()
        .map(|path| FilesystemAclEntry {
            path: path.clone(),
            principal_sid: principal_sid.to_string(),
            access: FilesystemAclAccess::DenyWrite,
            inherit_children: true,
        })
        .chain(grant.read_paths.iter().map(|path| FilesystemAclEntry {
            path: path.clone(),
            principal_sid: principal_sid.to_string(),
            access: FilesystemAclAccess::AllowRead,
            inherit_children: true,
        }))
        .chain(grant.writable_paths.iter().map(|path| FilesystemAclEntry {
            path: path.clone(),
            principal_sid: principal_sid.to_string(),
            access: FilesystemAclAccess::AllowWrite,
            inherit_children: true,
        }))
        .collect();
    Ok(FilesystemAclTransaction {
        principal_sid: principal_sid.to_string(),
        backup_paths,
        entries,
    })
}

#[allow(dead_code)]
fn backup_acl(transaction: &FilesystemAclTransaction) -> Result<AclBackup, String> {
    Ok(AclBackup {
        entries: transaction
            .backup_paths
            .iter()
            .map(|path| {
                Ok(AclBackupEntry {
                    path: path.clone(),
                    sddl: read_dacl_sddl(path)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
    })
}

#[allow(dead_code)]
fn apply_acl_transaction(
    transaction: &FilesystemAclTransaction,
    dry_run: bool,
) -> Result<Option<AclBackup>, String> {
    if transaction.entries.is_empty() {
        return Ok(None);
    }
    let backup = backup_acl(transaction)?;
    if dry_run {
        return Ok(Some(backup));
    }
    if let Err(error) = apply_acl_entries(transaction) {
        let _ = rollback_acl(&backup);
        return Err(error);
    }
    Ok(Some(backup))
}

#[allow(dead_code)]
fn rollback_acl(backup: &AclBackup) -> Result<(), String> {
    for entry in &backup.entries {
        restore_dacl_sddl(&entry.path, &entry.sddl)?;
    }
    Ok(())
}

fn acl_apply_mode_from_env() -> FilesystemAclApplyMode {
    match std::env::var(ACL_APPLY_MODE_ENV)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "1" | "true" | "apply" => FilesystemAclApplyMode::Apply,
        "dry-run" | "dry_run" | "dryrun" => FilesystemAclApplyMode::DryRun,
        _ => FilesystemAclApplyMode::Preflight,
    }
}

fn prepare_acl_for_exec(
    request: &ExecRequest,
    mode: FilesystemAclApplyMode,
) -> Result<Option<AppliedAclGuard>, String> {
    let grant_plan = filesystem_grant_plan(request)?;
    if mode == FilesystemAclApplyMode::Preflight {
        return Ok(None);
    }
    let transaction = filesystem_acl_transaction(&grant_plan, &sandbox_principal_sid()?)?;
    let backup = apply_acl_transaction(&transaction, mode == FilesystemAclApplyMode::DryRun)?;
    if mode == FilesystemAclApplyMode::DryRun {
        return Ok(None);
    }
    Ok(backup.map(|backup| AppliedAclGuard {
        backup: Some(backup),
    }))
}

#[cfg(not(windows))]
fn sandbox_principal_sid() -> Result<String, String> {
    Ok("dry-run-sid".to_string())
}

#[cfg(windows)]
fn sandbox_principal_sid() -> Result<String, String> {
    sid_to_string(&restricted_code_sid()?)
}

#[cfg(windows)]
fn restricted_code_sid() -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::{CreateWellKnownSid, WinRestrictedCodeSid};

    let mut sid = vec![0u8; 68];
    let mut sid_len = sid.len() as u32;
    unsafe {
        if CreateWellKnownSid(
            WinRestrictedCodeSid,
            std::ptr::null_mut(),
            sid.as_mut_ptr().cast(),
            &mut sid_len,
        ) == 0
        {
            return Err(format!(
                "CreateWellKnownSid(WinRestrictedCodeSid) failed: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    sid.truncate(sid_len as usize);
    Ok(sid)
}

#[cfg(windows)]
fn sid_to_string(sid: &[u8]) -> Result<String, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;

    unsafe {
        let mut sid_text = std::ptr::null_mut();
        if ConvertSidToStringSidW(sid.as_ptr() as _, &mut sid_text) == 0 {
            return Err(format!(
                "ConvertSidToStringSidW failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut len = 0;
        while *sid_text.add(len) != 0 {
            len += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(sid_text, len));
        LocalFree(sid_text.cast());
        Ok(text)
    }
}

#[cfg(not(windows))]
fn read_dacl_sddl(path: &str) -> Result<String, String> {
    Ok(format!("dry-run:{path}"))
}

#[cfg(windows)]
fn read_dacl_sddl(path: &str) -> Result<String, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertSecurityDescriptorToStringSecurityDescriptorW, GetNamedSecurityInfoW, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR};

    let wide_path = path.encode_utf16().chain([0]).collect::<Vec<_>>();
    unsafe {
        let mut security_descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        let result = GetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut security_descriptor,
        );
        if result != 0 {
            return Err(format!("GetNamedSecurityInfoW failed for {path}: {result}"));
        }
        let mut sddl = std::ptr::null_mut();
        let mut sddl_len = 0;
        let converted = ConvertSecurityDescriptorToStringSecurityDescriptorW(
            security_descriptor,
            1,
            DACL_SECURITY_INFORMATION,
            &mut sddl,
            &mut sddl_len,
        );
        LocalFree(security_descriptor);
        if converted == 0 {
            return Err(format!(
                "ConvertSecurityDescriptorToStringSecurityDescriptorW failed for {path}: {}",
                std::io::Error::last_os_error()
            ));
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(sddl, sddl_len as usize));
        LocalFree(sddl.cast());
        Ok(text)
    }
}

#[cfg(not(windows))]
fn restore_dacl_sddl(_path: &str, _sddl: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn restore_dacl_sddl(path: &str, sddl: &str) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{LocalFree, BOOL};
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SetNamedSecurityInfoW, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        GetSecurityDescriptorDacl, ACL, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    };

    let wide_path = path.encode_utf16().chain([0]).collect::<Vec<_>>();
    let wide_sddl = sddl.encode_utf16().chain([0]).collect::<Vec<_>>();
    unsafe {
        let mut security_descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide_sddl.as_ptr(),
            1,
            &mut security_descriptor,
            std::ptr::null_mut(),
        ) == 0
        {
            return Err(format!(
                "ConvertStringSecurityDescriptorToSecurityDescriptorW failed for {path}: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut present: BOOL = 0;
        let mut defaulted: BOOL = 0;
        let mut dacl: *mut ACL = std::ptr::null_mut();
        if GetSecurityDescriptorDacl(security_descriptor, &mut present, &mut dacl, &mut defaulted)
            == 0
        {
            LocalFree(security_descriptor);
            return Err(format!(
                "GetSecurityDescriptorDacl failed for {path}: {}",
                std::io::Error::last_os_error()
            ));
        }
        let result = SetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            dacl,
            std::ptr::null_mut(),
        );
        LocalFree(security_descriptor);
        if result != 0 {
            return Err(format!(
                "SetNamedSecurityInfoW rollback failed for {path}: {result}"
            ));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
fn apply_acl_entries(_transaction: &FilesystemAclTransaction) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn apply_acl_entries(transaction: &FilesystemAclTransaction) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{LocalFree, PSID};
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSidToSidW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW,
        DENY_ACCESS, EXPLICIT_ACCESS_W, GRANT_ACCESS, NO_MULTIPLE_TRUSTEE, SE_FILE_OBJECT,
        TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
    };
    use windows_sys::Win32::Security::{ACL, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR};
    use windows_sys::Win32::Storage::FileSystem::{
        DELETE, FILE_DELETE_CHILD, FILE_GENERIC_READ, FILE_GENERIC_WRITE, WRITE_DAC, WRITE_OWNER,
    };

    let sid_text = transaction
        .principal_sid
        .encode_utf16()
        .chain([0])
        .collect::<Vec<_>>();
    unsafe {
        let mut sid: PSID = std::ptr::null_mut();
        if ConvertStringSidToSidW(sid_text.as_ptr(), &mut sid) == 0 {
            return Err(format!(
                "ConvertStringSidToSidW failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        for path in &transaction.backup_paths {
            let path_entries = transaction
                .entries
                .iter()
                .filter(|entry| entry.path == *path)
                .map(|entry| {
                    let mask = match entry.access {
                        FilesystemAclAccess::DenyWrite => {
                            FILE_GENERIC_WRITE
                                | FILE_DELETE_CHILD
                                | DELETE
                                | WRITE_DAC
                                | WRITE_OWNER
                        }
                        FilesystemAclAccess::AllowRead => FILE_GENERIC_READ,
                        FilesystemAclAccess::AllowWrite => FILE_GENERIC_READ | FILE_GENERIC_WRITE,
                    };
                    EXPLICIT_ACCESS_W {
                        grfAccessPermissions: mask,
                        grfAccessMode: match entry.access {
                            FilesystemAclAccess::DenyWrite => DENY_ACCESS,
                            FilesystemAclAccess::AllowRead | FilesystemAclAccess::AllowWrite => {
                                GRANT_ACCESS
                            }
                        },
                        grfInheritance: if entry.inherit_children {
                            windows_sys::Win32::Security::SUB_CONTAINERS_AND_OBJECTS_INHERIT
                        } else {
                            windows_sys::Win32::Security::NO_INHERITANCE
                        },
                        Trustee: TRUSTEE_W {
                            pMultipleTrustee: std::ptr::null_mut(),
                            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                            TrusteeForm: TRUSTEE_IS_SID,
                            TrusteeType: TRUSTEE_IS_UNKNOWN,
                            ptstrName: sid as *mut u16,
                        },
                    }
                })
                .collect::<Vec<_>>();
            if path_entries.is_empty() {
                continue;
            }
            let wide_path = path.encode_utf16().chain([0]).collect::<Vec<_>>();
            let mut security_descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            let mut old_dacl: *mut ACL = std::ptr::null_mut();
            let read_result = GetNamedSecurityInfoW(
                wide_path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut old_dacl,
                std::ptr::null_mut(),
                &mut security_descriptor,
            );
            if read_result != 0 {
                LocalFree(sid);
                return Err(format!(
                    "GetNamedSecurityInfoW failed for {path}: {read_result}"
                ));
            }
            let mut new_dacl: *mut ACL = std::ptr::null_mut();
            let acl_result = SetEntriesInAclW(
                path_entries.len() as u32,
                path_entries.as_ptr(),
                old_dacl,
                &mut new_dacl,
            );
            if acl_result != 0 {
                LocalFree(security_descriptor);
                LocalFree(sid);
                return Err(format!("SetEntriesInAclW failed for {path}: {acl_result}"));
            }
            let write_result = SetNamedSecurityInfoW(
                wide_path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                new_dacl,
                std::ptr::null_mut(),
            );
            LocalFree(new_dacl.cast());
            LocalFree(security_descriptor);
            if write_result != 0 {
                LocalFree(sid);
                return Err(format!(
                    "SetNamedSecurityInfoW failed for {path}: {write_result}"
                ));
            }
        }
        LocalFree(sid);
    }
    Ok(())
}

#[cfg(windows)]
fn restricted_token_launch_supported() -> bool {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Security::TOKEN_ALL_ACCESS;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token: HANDLE = 0;
        if OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &mut token) == 0 {
            return false;
        }
        let token = OwnedHandle(token);
        enable_token_privilege(token.0, "SeImpersonatePrivilege").is_ok()
    }
}

#[cfg(not(windows))]
fn restricted_token_launch_supported() -> bool {
    false
}

#[cfg(windows)]
fn process_is_elevated() -> bool {
    use windows_sys::Win32::Foundation::BOOL;
    use windows_sys::Win32::Security::{
        CheckTokenMembership, CreateWellKnownSid, WinBuiltinAdministratorsSid,
    };

    unsafe {
        let mut admin_sid = vec![0u8; 68];
        let mut admin_sid_len = admin_sid.len() as u32;
        if CreateWellKnownSid(
            WinBuiltinAdministratorsSid,
            std::ptr::null_mut(),
            admin_sid.as_mut_ptr().cast(),
            &mut admin_sid_len,
        ) == 0
        {
            return false;
        }
        admin_sid.truncate(admin_sid_len as usize);
        let mut is_member: BOOL = 0;
        CheckTokenMembership(0, admin_sid.as_mut_ptr().cast(), &mut is_member) != 0
            && is_member != 0
    }
}

#[cfg(not(windows))]
fn process_is_elevated() -> bool {
    false
}

fn path_text_issue(input: &str) -> Option<&'static str> {
    if input.contains('\0') {
        return Some("contains NUL byte");
    }
    if input.is_empty() {
        return Some("is empty");
    }
    let normalized = input.replace('/', "\\");
    if normalized.split('\\').any(|segment| {
        segment.chars().any(|char| char == '~') && segment.chars().any(|char| char.is_ascii_digit())
    }) {
        return Some("contains 8.3 short-name segment");
    }
    for (index, char) in normalized.char_indices() {
        if char != ':' {
            continue;
        }
        if is_allowed_drive_colon(&normalized, index) {
            continue;
        }
        return Some("contains alternate data stream marker");
    }
    None
}

fn is_allowed_drive_colon(value: &str, index: usize) -> bool {
    const DEVICE_PREFIX: &str = "\\\\?\\";
    const DOS_DEVICE_PREFIX: &str = "\\\\.\\";
    if index == 1 {
        return value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic)
            && value.as_bytes().get(2).is_some_and(|item| *item == b'\\');
    }
    if index == 5 && (value.starts_with(DEVICE_PREFIX) || value.starts_with(DOS_DEVICE_PREFIX)) {
        return value.as_bytes().get(4).is_some_and(u8::is_ascii_alphabetic)
            && value.as_bytes().get(6).is_some_and(|item| *item == b'\\');
    }
    false
}

#[cfg(windows)]
fn canonicalize_sandbox_path(label: &str, input: &str) -> Result<String, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, GetFinalPathNameByHandleW, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING, VOLUME_NAME_DOS,
    };

    if let Some(issue) = path_text_issue(input) {
        return Err(format!("{label} {issue}: {input}"));
    }
    let wide = input.encode_utf16().chain([0]).collect::<Vec<_>>();
    unsafe {
        let handle = CreateFileW(
            wide.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            0,
        );
        if handle == INVALID_HANDLE_VALUE {
            return Err(format!(
                "{label} cannot be opened for canonicalization: {input}: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut buffer = vec![0u16; 32768];
        let length = GetFinalPathNameByHandleW(
            handle,
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            VOLUME_NAME_DOS,
        );
        CloseHandle(handle);
        if length == 0 {
            return Err(format!(
                "{label} final path lookup failed: {input}: {}",
                std::io::Error::last_os_error()
            ));
        }
        if length as usize >= buffer.len() {
            return Err(format!("{label} final path is too long: {input}"));
        }
        Ok(String::from_utf16_lossy(&buffer[..length as usize]).to_ascii_lowercase())
    }
}

#[cfg(not(windows))]
fn canonicalize_sandbox_path(label: &str, input: &str) -> Result<String, String> {
    if let Some(issue) = path_text_issue(input) {
        return Err(format!("{label} {issue}: {input}"));
    }
    std::fs::canonicalize(input)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| format!("{label} cannot be canonicalized: {input}: {error}"))
}

fn shell_args(request: &ExecRequest) -> Vec<String> {
    if request.shell_family == "powershell" {
        return vec![
            "-NoLogo".to_string(),
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-EncodedCommand".to_string(),
            utf16le_base64(&request.command),
        ];
    }
    if request.shell_family == "cmd" {
        return vec![
            "/d".to_string(),
            "/s".to_string(),
            "/c".to_string(),
            request.command.clone(),
        ];
    }
    vec!["-c".to_string(), request.command.clone()]
}

fn exec() -> Result<(), String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| error.to_string())?;
    let request: ExecRequest = serde_json::from_str(&input).map_err(|error| error.to_string())?;
    exec_request(request)
}

#[cfg(windows)]
fn exec_request(request: ExecRequest) -> Result<(), String> {
    let acl_guard = prepare_acl_for_exec(&request, acl_apply_mode_from_env())?;
    let filesystem_enforced = acl_guard.is_some();
    let result = exec_request_inner(&request, filesystem_enforced);
    let rollback = match acl_guard {
        Some(guard) => guard.finish(),
        None => Ok(()),
    };
    match (result, rollback) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(rollback_error)) => Err(format!("ACL rollback failed: {rollback_error}")),
        (Err(error), Err(rollback_error)) => {
            Err(format!("{error}; ACL rollback failed: {rollback_error}"))
        }
    }
}

#[cfg(windows)]
fn exec_request_inner(request: &ExecRequest, filesystem_enforced: bool) -> Result<(), String> {
    let started = Instant::now();
    let process = spawn_restricted_process(request)?;
    let timeout = Duration::from_millis(request.timeout_ms);
    loop {
        if started.elapsed() >= timeout {
            terminate_job_object(&process.job);
            terminate_process(process.process_handle);
            let (stdout, stderr) = process.wait_output()?;
            return print_json(&exec_output(
                request,
                None,
                "timeout",
                stdout,
                stderr,
                filesystem_enforced,
            ));
        }
        if let Some(exit_code) = process.try_exit_code()? {
            let (stdout, stderr) = process.wait_output()?;
            return print_json(&exec_output(
                request,
                Some(exit_code),
                "exit",
                stdout,
                stderr,
                filesystem_enforced,
            ));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(not(windows))]
fn exec_request(request: ExecRequest) -> Result<(), String> {
    prepare_acl_for_exec(&request, FilesystemAclApplyMode::Preflight)?;
    let started = Instant::now();
    let mut command = Command::new(&request.shell);
    command
        .args(shell_args(&request))
        .current_dir(&request.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear()
        .envs(&request.env);

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let job = assign_job_object(&child)?;
    let timeout = Duration::from_millis(request.timeout_ms);
    loop {
        if started.elapsed() >= timeout {
            terminate_job_object(&job);
            let _ = child.kill();
            let output = child
                .wait_with_output()
                .map_err(|error| error.to_string())?;
            return print_json(&exec_output(
                &request,
                None,
                "timeout",
                output.stdout,
                output.stderr,
                false,
            ));
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            let output = child
                .wait_with_output()
                .map_err(|error| error.to_string())?;
            return print_json(&exec_output(
                &request,
                status.code(),
                "exit",
                output.stdout,
                output.stderr,
                false,
            ));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn exec_output(
    request: &ExecRequest,
    exit_code: Option<i32>,
    reason: &str,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    filesystem_enforced: bool,
) -> ExecOutput {
    let network_enforced = request.network_policy == "none"
        && wfp_setup_state()
            .enforced_policies()
            .iter()
            .any(|item| item == "none");
    let enforced = filesystem_enforced || network_enforced;
    ExecOutput {
        request_id: request.request_id.clone(),
        exit_code,
        termination_reason: reason.to_string(),
        backend_used: "windows_native".to_string(),
        stdout_tail: String::from_utf8_lossy(&stdout).to_string(),
        stderr_tail: String::from_utf8_lossy(&stderr).to_string(),
        policy_advisory: PolicyAdvisory {
            enforcement: request.enforcement.clone(),
            backend_preference: request.backend_preference.clone(),
            filesystem_policy: request.filesystem_policy.clone(),
            network_policy: request.network_policy.clone(),
            allowed_paths: request.allowed_paths.clone(),
            writable_paths: request.writable_paths.clone(),
            report_only: false,
            enforced,
            filesystem_enforced,
            network_enforced,
            windows_sandbox_mode: if enforced {
                "restricted_token".to_string()
            } else {
                "job_object_only".to_string()
            },
        },
    }
}

#[cfg(windows)]
struct JobHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
struct OwnedHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for JobHandle {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(windows)]
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.0);
            }
        }
    }
}

#[cfg(windows)]
fn terminate_job_object(job: &JobHandle) {
    unsafe {
        windows_sys::Win32::System::JobObjects::TerminateJobObject(job.0, 1);
    }
}

#[cfg(windows)]
fn terminate_process(process: windows_sys::Win32::Foundation::HANDLE) {
    unsafe {
        windows_sys::Win32::System::Threading::TerminateProcess(process, 1);
    }
}

#[cfg(windows)]
fn create_job_object_for_process(
    process: windows_sys::Win32::Foundation::HANDLE,
) -> Result<JobHandle, String> {
    use std::mem::size_of;
    use std::ptr::null_mut;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let job = CreateJobObjectW(null_mut(), std::ptr::null());
        if job == 0 {
            return Err(format!(
                "CreateJobObjectW failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let handle = JobHandle(job);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        if SetInformationJobObject(
            handle.0,
            JobObjectExtendedLimitInformation,
            &mut limits as *mut _ as *mut _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            return Err(format!(
                "SetInformationJobObject failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        if AssignProcessToJobObject(handle.0, process) == 0 {
            return Err(format!(
                "AssignProcessToJobObject failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(handle)
    }
}

#[cfg(windows)]
struct RestrictedProcess {
    process_handle: windows_sys::Win32::Foundation::HANDLE,
    _thread_handle: OwnedHandle,
    stdout_read: OwnedHandle,
    stderr_read: OwnedHandle,
    job: JobHandle,
}

#[cfg(windows)]
impl Drop for RestrictedProcess {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.process_handle);
        }
    }
}

#[cfg(windows)]
impl RestrictedProcess {
    fn try_exit_code(&self) -> Result<Option<i32>, String> {
        use windows_sys::Win32::Foundation::STILL_ACTIVE;
        use windows_sys::Win32::System::Threading::GetExitCodeProcess;

        unsafe {
            let mut exit_code = 0u32;
            if GetExitCodeProcess(self.process_handle, &mut exit_code) == 0 {
                return Err(format!(
                    "GetExitCodeProcess failed: {}",
                    std::io::Error::last_os_error()
                ));
            }
            if exit_code == STILL_ACTIVE as u32 {
                return Ok(None);
            }
            Ok(Some(exit_code as i32))
        }
    }

    fn wait_output(self) -> Result<(Vec<u8>, Vec<u8>), String> {
        use windows_sys::Win32::System::Threading::{WaitForSingleObject, INFINITE};

        unsafe {
            WaitForSingleObject(self.process_handle, INFINITE);
        }
        Ok((
            read_pipe_to_end(self.stdout_read.0)?,
            read_pipe_to_end(self.stderr_read.0)?,
        ))
    }
}

#[cfg(windows)]
fn spawn_restricted_process(request: &ExecRequest) -> Result<RestrictedProcess, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{HANDLE, TRUE};
    use windows_sys::Win32::Security::{
        DuplicateTokenEx, SecurityImpersonation, TokenPrimary, SECURITY_ATTRIBUTES,
        TOKEN_ALL_ACCESS,
    };
    use windows_sys::Win32::System::Threading::{
        CreateProcessWithTokenW, GetCurrentProcess, OpenProcessToken, CREATE_NO_WINDOW,
        CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTF_USESTDHANDLES,
        STARTUPINFOW,
    };

    unsafe {
        let mut current_token: HANDLE = 0;
        if OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &mut current_token) == 0 {
            return Err(format!(
                "OpenProcessToken failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let current_token = OwnedHandle(current_token);
        enable_token_privilege(current_token.0, "SeImpersonatePrivilege")?;
        let mut restricted_token: HANDLE = 0;
        if DuplicateTokenEx(
            current_token.0,
            TOKEN_ALL_ACCESS,
            null(),
            SecurityImpersonation,
            TokenPrimary,
            &mut restricted_token,
        ) == 0
        {
            return Err(format!(
                "DuplicateTokenEx failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let restricted_token = create_restricted_token(OwnedHandle(restricted_token))?;

        let mut security = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: TRUE,
        };
        let (stdout_read, stdout_write) = create_inheritable_pipe(&mut security)?;
        let (stderr_read, stderr_write) = create_inheritable_pipe(&mut security)?;
        let (stdin_read, stdin_write) = create_inheritable_pipe(&mut security)?;
        make_handle_not_inheritable(stdout_read.0)?;
        make_handle_not_inheritable(stderr_read.0)?;
        make_handle_not_inheritable(stdin_write.0)?;

        let mut startup: STARTUPINFOW = std::mem::zeroed();
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdOutput = stdout_write.0;
        startup.hStdError = stderr_write.0;
        startup.hStdInput = stdin_read.0;
        let mut info: PROCESS_INFORMATION = std::mem::zeroed();
        let mut command_line = windows_command_line(request);
        let mut cwd = request.cwd.encode_utf16().chain([0]).collect::<Vec<_>>();
        let mut env = environment_block(&request.env);
        if CreateProcessWithTokenW(
            restricted_token.0,
            0,
            null(),
            command_line.as_mut_ptr(),
            CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
            env.as_mut_ptr() as *const _,
            cwd.as_mut_ptr(),
            &startup,
            &mut info,
        ) == 0
        {
            return Err(format!(
                "CreateProcessWithTokenW failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        drop(stdout_write);
        drop(stderr_write);
        drop(stdin_read);
        drop(stdin_write);
        let job = create_job_object_for_process(info.hProcess)?;
        windows_sys::Win32::System::Threading::ResumeThread(info.hThread);
        Ok(RestrictedProcess {
            process_handle: info.hProcess,
            _thread_handle: OwnedHandle(info.hThread),
            stdout_read,
            stderr_read,
            job,
        })
    }
}

#[cfg(windows)]
fn create_restricted_token(token: OwnedHandle) -> Result<OwnedHandle, String> {
    use windows_sys::Win32::Security::{
        CreateRestrictedToken, DISABLE_MAX_PRIVILEGE, LUID_AND_ATTRIBUTES, SID_AND_ATTRIBUTES,
    };
    const SE_GROUP_ENABLED: u32 = 0x00000004;

    unsafe {
        let mut restricted = 0;
        let restricted_sid = restricted_code_sid()?;
        let restricted_sids = [SID_AND_ATTRIBUTES {
            Sid: restricted_sid.as_ptr() as _,
            Attributes: SE_GROUP_ENABLED,
        }];
        if CreateRestrictedToken(
            token.0,
            DISABLE_MAX_PRIVILEGE,
            0,
            std::ptr::null::<SID_AND_ATTRIBUTES>(),
            0,
            std::ptr::null::<LUID_AND_ATTRIBUTES>(),
            restricted_sids.len() as u32,
            restricted_sids.as_ptr(),
            &mut restricted,
        ) == 0
        {
            return Err(format!(
                "CreateRestrictedToken failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(OwnedHandle(restricted))
    }
}

#[cfg(windows)]
fn enable_token_privilege(
    token: windows_sys::Win32::Foundation::HANDLE,
    privilege_name: &str,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{ERROR_NOT_ALL_ASSIGNED, LUID};
    use windows_sys::Win32::Security::{
        AdjustTokenPrivileges, LookupPrivilegeValueW, SE_PRIVILEGE_ENABLED, TOKEN_PRIVILEGES,
    };

    unsafe {
        let mut luid = LUID {
            LowPart: 0,
            HighPart: 0,
        };
        let wide_name = privilege_name.encode_utf16().chain([0]).collect::<Vec<_>>();
        if LookupPrivilegeValueW(std::ptr::null(), wide_name.as_ptr(), &mut luid) == 0 {
            return Err(format!(
                "LookupPrivilegeValueW failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut privileges = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [windows_sys::Win32::Security::LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };
        if AdjustTokenPrivileges(
            token,
            0,
            &mut privileges,
            std::mem::size_of::<TOKEN_PRIVILEGES>() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        ) == 0
        {
            return Err(format!(
                "AdjustTokenPrivileges failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        if std::io::Error::last_os_error().raw_os_error() == Some(ERROR_NOT_ALL_ASSIGNED as i32) {
            return Err(format!(
                "{privilege_name} is not assigned to this process token"
            ));
        }
        Ok(())
    }
}

#[cfg(windows)]
fn create_inheritable_pipe(
    security: &mut windows_sys::Win32::Security::SECURITY_ATTRIBUTES,
) -> Result<(OwnedHandle, OwnedHandle), String> {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::Pipes::CreatePipe;

    unsafe {
        let mut read: HANDLE = 0;
        let mut write: HANDLE = 0;
        if CreatePipe(&mut read, &mut write, security, 0) == 0 {
            return Err(format!(
                "CreatePipe failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok((OwnedHandle(read), OwnedHandle(write)))
    }
}

#[cfg(windows)]
fn make_handle_not_inheritable(
    handle: windows_sys::Win32::Foundation::HANDLE,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT};

    unsafe {
        if SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) == 0 {
            return Err(format!(
                "SetHandleInformation failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

#[cfg(windows)]
fn read_pipe_to_end(handle: windows_sys::Win32::Foundation::HANDLE) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::FALSE;
    use windows_sys::Win32::Storage::FileSystem::ReadFile;

    let mut output = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let mut read = 0u32;
        unsafe {
            if ReadFile(
                handle,
                buffer.as_mut_ptr() as *mut _,
                buffer.len() as u32,
                &mut read,
                std::ptr::null_mut(),
            ) == FALSE
            {
                break;
            }
        }
        if read == 0 {
            break;
        }
        output.extend_from_slice(&buffer[..read as usize]);
    }
    Ok(output)
}

#[cfg(windows)]
fn environment_block(env: &BTreeMap<String, String>) -> Vec<u16> {
    env.iter()
        .flat_map(|(key, value)| {
            format!("{key}={value}")
                .encode_utf16()
                .chain([0])
                .collect::<Vec<_>>()
        })
        .chain([0])
        .collect()
}

#[cfg(windows)]
fn windows_command_line(request: &ExecRequest) -> Vec<u16> {
    std::iter::once(quote_windows_arg(&request.shell))
        .chain(
            shell_args(request)
                .into_iter()
                .map(|item| quote_windows_arg(&item)),
        )
        .collect::<Vec<_>>()
        .join(" ")
        .encode_utf16()
        .chain([0])
        .collect()
}

#[cfg(windows)]
fn quote_windows_arg(input: &str) -> String {
    if input.is_empty() {
        return "\"\"".to_string();
    }
    if !input
        .chars()
        .any(|char| char.is_whitespace() || char == '"')
    {
        return input.to_string();
    }
    let mut output = String::from("\"");
    let mut slashes = 0;
    for char in input.chars() {
        if char == '\\' {
            slashes += 1;
            continue;
        }
        if char == '"' {
            output.push_str(&"\\".repeat(slashes * 2 + 1));
            output.push('"');
            slashes = 0;
            continue;
        }
        output.push_str(&"\\".repeat(slashes));
        slashes = 0;
        output.push(char);
    }
    output.push_str(&"\\".repeat(slashes * 2));
    output.push('"');
    output
}

#[cfg(not(windows))]
fn assign_job_object(_child: &std::process::Child) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn terminate_job_object(_job: &()) {}

fn utf16le_base64(input: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input
        .encode_utf16()
        .flat_map(|unit| [(unit & 0xff) as u8, (unit >> 8) as u8])
        .collect::<Vec<_>>();
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b11) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(((b1 & 0b1111) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(b2 & 0b11_1111) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn windows_build() -> Option<String> {
    #[cfg(windows)]
    {
        std::env::var("OS").ok()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn run() -> Result<(), String> {
    let args = std::env::args().collect::<Vec<_>>();
    match args.get(1).map(String::as_str) {
        Some("probe") => print_json(&probe()),
        Some("exec") => exec(),
        Some("serve") => Err("serve protocol is reserved; use exec for this helper build".to_string()),
        Some("setup") if args.iter().any(|arg| arg == "--install") => print_json(&setup("install")),
        Some("setup") if args.iter().any(|arg| arg == "--uninstall") => print_json(&setup("uninstall")),
        Some("setup") if args.iter().any(|arg| arg == "--status") => print_json(&setup("status")),
        _ => Err("usage: openagt-sandbox-win <probe --json|exec|setup --install|setup --uninstall|setup --status> [--json]".to_string()),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_acl_transaction, filesystem_acl_transaction, filesystem_grant_plan,
        is_allowed_drive_colon, path_text_issue, prepare_acl_for_exec, rollback_acl, ExecRequest,
        FilesystemAclAccess, FilesystemAclApplyMode,
    };
    use std::collections::BTreeMap;
    use std::fs;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    const RUN_WINDOWS_ACL_TESTS_ENV: &str = "OPENAGT_RUN_WINDOWS_ACL_TESTS";
    const RUN_WINDOWS_WFP_TESTS_ENV: &str = "OPENAGT_RUN_WINDOWS_WFP_TESTS";

    #[test]
    fn accepts_normal_drive_paths() {
        assert!(path_text_issue(r"C:\Users\Administrator\Desktop\OpenAG").is_none());
        assert!(is_allowed_drive_colon(r"C:\Users", 1));
        assert!(is_allowed_drive_colon(r"\\?\C:\Users", 5));
    }

    #[test]
    fn rejects_alternate_data_streams() {
        assert_eq!(
            path_text_issue(r"C:\Users\Administrator\Desktop\OpenAG\file.txt:hidden"),
            Some("contains alternate data stream marker")
        );
    }

    #[test]
    fn rejects_drive_relative_paths() {
        assert_eq!(
            path_text_issue(r"C:relative\path"),
            Some("contains alternate data stream marker")
        );
    }

    #[test]
    fn rejects_short_name_segments() {
        assert_eq!(
            path_text_issue(r"C:\PROGRA~1\OpenAG"),
            Some("contains 8.3 short-name segment")
        );
    }

    #[test]
    fn rejects_nul_bytes() {
        assert_eq!(path_text_issue("C:\\OpenAG\0x"), Some("contains NUL byte"));
    }

    fn temp_case(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("openagt-sandbox-win-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn request(
        cwd: &PathBuf,
        allowed: Vec<PathBuf>,
        writable: Vec<PathBuf>,
        policy: &str,
    ) -> ExecRequest {
        ExecRequest {
            request_id: "test".to_string(),
            command: "echo test".to_string(),
            shell_family: "cmd".to_string(),
            shell: "cmd.exe".to_string(),
            cwd: cwd.to_string_lossy().to_string(),
            timeout_ms: 1_000,
            env: BTreeMap::new(),
            enforcement: "required".to_string(),
            backend_preference: "windows_native".to_string(),
            filesystem_policy: policy.to_string(),
            allowed_paths: allowed
                .into_iter()
                .map(|item| item.to_string_lossy().to_string())
                .collect(),
            writable_paths: writable
                .into_iter()
                .map(|item| item.to_string_lossy().to_string())
                .collect(),
            network_policy: "none".to_string(),
        }
    }

    struct EnvVarRestore {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvVarRestore {
        fn set(key: &'static str, value: &str) -> Self {
            let previous = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarRestore {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    struct WfpSetupRestore {
        was_installed: bool,
    }

    impl WfpSetupRestore {
        fn install() -> Self {
            let was_installed = super::setup("status").setup_installed;
            let install = super::setup("install");
            assert!(install.ok, "{install:?}");
            assert!(install.setup_installed);
            assert_eq!(install.network_policies_enforced, vec!["none".to_string()]);
            Self { was_installed }
        }
    }

    impl Drop for WfpSetupRestore {
        fn drop(&mut self) {
            if self.was_installed {
                let _ = super::setup("install");
                return;
            }
            let _ = super::setup("uninstall");
        }
    }

    fn with_wfp_setup_restored(body: impl FnOnce()) {
        let _restore = WfpSetupRestore::install();
        body();
    }

    fn assert_wfp_setup_uninstalls() {
        let uninstall = super::setup("uninstall");
        assert!(uninstall.ok, "{uninstall:?}");
        assert!(!uninstall.setup_installed);
        assert!(uninstall.setup_required);
    }

    fn assert_wfp_setup_installs() {
        let install = super::setup("install");
        assert!(install.ok, "{install:?}");
        assert!(install.setup_installed);
        assert_eq!(install.network_policies_enforced, vec!["none".to_string()]);
    }

    fn assert_wfp_setup_status_installed() {
        let status = super::setup("status");
        assert!(status.ok);
        assert!(status.setup_installed);
        assert!(status.network_enforced);
    }

    fn assert_wfp_setup_status_missing() {
        if super::setup("status").setup_installed {
            assert_wfp_setup_uninstalls();
            return;
        }
        let status = super::setup("status");
        assert!(status.ok);
        assert!(!status.setup_installed);
        assert!(status.setup_required);
    }

    fn powershell_path() -> String {
        format!(
            r"{}\System32\WindowsPowerShell\v1.0\powershell.exe",
            std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string())
        )
    }

    fn powershell_literal(value: &str) -> String {
        format!("'{}'", value.replace('\'', "''"))
    }

    fn exec_loopback_connection_attempt(network_policy: &str) -> bool {
        let dir = temp_case(&format!("wfp-network-{network_policy}"));
        let marker = dir.join(format!("attempted-{network_policy}.txt"));
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let started = Instant::now();
            while started.elapsed() < Duration::from_millis(2_000) {
                match listener.accept() {
                    Ok(_) => {
                        let _ = tx.send(true);
                        return;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    Err(_) => break,
                }
            }
            let _ = tx.send(false);
        });

        let mut exec_request = request(
            &dir,
            vec![dir.clone()],
            vec![dir.clone()],
            "workspace_write",
        );
        exec_request.shell_family = "powershell".to_string();
        exec_request.shell = powershell_path();
        exec_request.network_policy = network_policy.to_string();
        exec_request.timeout_ms = 5_000;
        exec_request.env = BTreeMap::from([(
            "SystemRoot".to_string(),
            std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string()),
        )]);
        exec_request.command = format!(
            "Set-Content -LiteralPath {} -Value attempted; $client = [Net.Sockets.TcpClient]::new(); $async = $client.BeginConnect('127.0.0.1', {}, $null, $null); if ($async.AsyncWaitHandle.WaitOne(800)) {{ try {{ $client.EndConnect($async); exit 42 }} catch {{ exit 0 }} }} else {{ exit 0 }}",
            powershell_literal(&marker.to_string_lossy()),
            port
        );

        let _acl_mode = EnvVarRestore::set(super::ACL_APPLY_MODE_ENV, "apply");
        super::exec_request(exec_request).unwrap();
        assert!(marker.exists());
        let accepted = rx
            .recv_timeout(Duration::from_millis(3_000))
            .unwrap_or(false);
        let _ = fs::remove_dir_all(dir);
        accepted
    }

    #[test]
    fn grant_plan_rejects_read_only_writable_paths() {
        let dir = temp_case("readonly-writable");
        let result = filesystem_grant_plan(&request(
            &dir,
            vec![dir.clone()],
            vec![dir.clone()],
            "read_only",
        ));
        assert_eq!(
            result.unwrap_err(),
            "read_only filesystem policy cannot include writable_paths"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn grant_plan_rejects_writable_paths_outside_allowed_paths() {
        let dir = temp_case("write-outside-allowed");
        let external = temp_case("write-outside-allowed-external");
        let result = filesystem_grant_plan(&request(
            &dir,
            vec![dir.clone()],
            vec![external.clone()],
            "workspace_write",
        ));
        assert!(result
            .unwrap_err()
            .contains("writable_path is not inside allowed_paths"));
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(external);
    }

    #[test]
    fn grant_plan_adds_workspace_write_deny_paths() {
        let dir = temp_case("workspace-deny");
        let plan = filesystem_grant_plan(&request(
            &dir,
            vec![dir.clone()],
            vec![dir.clone()],
            "workspace_write",
        ))
        .unwrap();
        assert!(plan
            .deny_write_paths
            .iter()
            .any(|item| item.ends_with("\\.git")));
        assert!(plan
            .deny_write_paths
            .iter()
            .any(|item| item.ends_with("\\.openagt")));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn acl_transaction_orders_deny_entries_before_allow_entries() {
        let dir = temp_case("acl-order");
        let plan = filesystem_grant_plan(&request(
            &dir,
            vec![dir.clone()],
            vec![dir.clone()],
            "workspace_write",
        ))
        .unwrap();
        let transaction = filesystem_acl_transaction(&plan, "S-1-15-2-1").unwrap();
        let first_allow = transaction
            .entries
            .iter()
            .position(|entry| entry.access != FilesystemAclAccess::DenyWrite)
            .unwrap();

        assert!(first_allow > 0);
        assert!(transaction.entries[..first_allow]
            .iter()
            .all(|entry| entry.access == FilesystemAclAccess::DenyWrite));
        assert!(transaction.entries[first_allow..]
            .iter()
            .all(|entry| entry.access != FilesystemAclAccess::DenyWrite));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn acl_transaction_records_backup_paths_for_rollback() {
        let dir = temp_case("acl-rollback");
        let readonly = dir.join("readonly");
        fs::create_dir_all(&readonly).unwrap();
        let plan = filesystem_grant_plan(&request(
            &dir,
            vec![dir.clone(), readonly.clone()],
            vec![dir.clone()],
            "workspace_write",
        ))
        .unwrap();
        let transaction = filesystem_acl_transaction(&plan, "S-1-15-2-1").unwrap();

        assert!(transaction
            .backup_paths
            .iter()
            .any(|item| item.ends_with("readonly")));
        assert!(transaction
            .backup_paths
            .iter()
            .any(|item| item.ends_with("\\.git")));
        assert!(transaction
            .backup_paths
            .iter()
            .any(|item| item == &plan.writable_paths[0]));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn acl_transaction_requires_principal_sid() {
        let dir = temp_case("acl-sid");
        let plan = filesystem_grant_plan(&request(
            &dir,
            vec![dir.clone()],
            vec![dir.clone()],
            "workspace_write",
        ))
        .unwrap();

        assert_eq!(
            filesystem_acl_transaction(&plan, " ").unwrap_err(),
            "ACL transaction requires a sandbox principal SID"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn acl_transaction_dry_run_captures_backup_without_applying() {
        let dir = temp_case("acl-dry-run");
        let plan =
            filesystem_grant_plan(&request(&dir, vec![dir.clone()], vec![], "read_only")).unwrap();
        let transaction = filesystem_acl_transaction(&plan, "S-1-15-2-1").unwrap();
        let backup = apply_acl_transaction(&transaction, true).unwrap().unwrap();

        assert!(!backup.entries.is_empty());
        assert!(backup.entries.iter().all(|entry| !entry.sddl.is_empty()));
        rollback_acl(&backup).unwrap();
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn exec_acl_preflight_does_not_create_guard() {
        let dir = temp_case("exec-acl-preflight");
        let guard = prepare_acl_for_exec(
            &request(&dir, vec![dir.clone()], vec![], "read_only"),
            FilesystemAclApplyMode::Preflight,
        )
        .unwrap();

        assert!(guard.is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn exec_acl_dry_run_validates_without_installing_guard() {
        let dir = temp_case("exec-acl-dry-run");
        let guard = prepare_acl_for_exec(
            &request(&dir, vec![dir.clone()], vec![], "read_only"),
            FilesystemAclApplyMode::DryRun,
        )
        .unwrap();

        assert!(guard.is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn sandbox_principal_uses_restricted_code_sid() {
        assert_eq!(super::sandbox_principal_sid().unwrap(), "S-1-5-12");
    }

    #[cfg(windows)]
    #[test]
    fn wfp_user_match_condition_uses_security_descriptor_blob() {
        let condition = super::WfpUserMatchCondition::for_restricted_code().unwrap();

        assert!(condition.blob.size > 0);
        assert!(!condition.blob.data.is_null());
    }

    #[cfg(windows)]
    #[test]
    fn gated_acl_enforcement_allows_workspace_write_and_blocks_git_write() {
        if std::env::var(RUN_WINDOWS_ACL_TESTS_ENV).as_deref() != Ok("1") {
            return;
        }
        if !super::restricted_token_launch_supported() {
            return;
        }
        let dir = temp_case("acl-enforcement");
        let git = dir.join(".git");
        fs::create_dir_all(&git).unwrap();
        let previous_mode = std::env::var(super::ACL_APPLY_MODE_ENV).ok();
        std::env::set_var(super::ACL_APPLY_MODE_ENV, "apply");
        let mut exec_request = request(
            &dir,
            vec![dir.clone()],
            vec![dir.clone()],
            "workspace_write",
        );
        exec_request.command =
            "echo allowed> allowed.txt && echo blocked> .git\\blocked.txt".to_string();
        exec_request.env = BTreeMap::from([
            (
                "ComSpec".to_string(),
                std::env::var("ComSpec").unwrap_or_default(),
            ),
            (
                "SystemRoot".to_string(),
                std::env::var("SystemRoot").unwrap_or_default(),
            ),
        ]);
        exec_request.timeout_ms = 10_000;

        let result = super::exec_request(exec_request);
        match previous_mode {
            Some(value) => std::env::set_var(super::ACL_APPLY_MODE_ENV, value),
            None => std::env::remove_var(super::ACL_APPLY_MODE_ENV),
        }

        result.unwrap();
        assert!(dir.join("allowed.txt").exists());
        assert!(!git.join("blocked.txt").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn wfp_setup_state_only_enforces_none_when_complete() {
        let missing = super::WfpSetupState {
            engine_available: true,
            provider_installed: true,
            sublayer_installed: true,
            outbound_v4_filter_installed: true,
            outbound_v6_filter_installed: true,
            inbound_v4_filter_installed: true,
            inbound_v6_filter_installed: false,
            setup_version: super::SETUP_VERSION.to_string(),
            reason: None,
        };
        assert!(!missing.installed());
        assert!(missing.setup_required());
        assert!(missing.enforced_policies().is_empty());

        let stale = super::WfpSetupState {
            inbound_v6_filter_installed: true,
            setup_version: "0".to_string(),
            ..missing.clone()
        };
        assert!(!stale.installed());
        assert!(stale.enforced_policies().is_empty());

        let complete = super::WfpSetupState {
            setup_version: super::SETUP_VERSION.to_string(),
            ..stale
        };
        assert!(complete.installed());
        assert_eq!(complete.enforced_policies(), vec!["none".to_string()]);
    }

    #[test]
    fn native_readiness_distinguishes_setup_and_admin_gate() {
        let complete = super::WfpSetupState {
            engine_available: true,
            provider_installed: true,
            sublayer_installed: true,
            outbound_v4_filter_installed: true,
            outbound_v6_filter_installed: true,
            inbound_v4_filter_installed: true,
            inbound_v6_filter_installed: true,
            setup_version: super::SETUP_VERSION.to_string(),
            reason: None,
        };
        let missing = super::WfpSetupState {
            inbound_v6_filter_installed: false,
            ..complete.clone()
        };

        assert_eq!(
            super::native_readiness(true, false, &complete, false),
            "acl_apply_required"
        );
        assert_eq!(
            super::native_readiness(true, true, &missing, false),
            "setup_required"
        );
        assert_eq!(
            super::native_readiness(true, true, &complete, false),
            "admin_verification_required"
        );
        assert_eq!(
            super::native_readiness(true, true, &complete, true),
            "ready"
        );
    }

    #[test]
    fn admin_gate_report_requires_execution_gate() {
        let dir = temp_case("admin-gate-report");
        let report = dir.join("admin-gate-report.json");

        fs::write(
            &report,
            r#"{"schema_version":1,"gate":"windows_sandbox_admin_preflight","status":"passed","generated_at":"2026-05-12T00:00:00.000Z","results":[]}"#,
        )
        .unwrap();
        assert_eq!(
            super::admin_gate_verified_at(report.to_str()),
            None,
            "preflight-only reports must not satisfy the admin execution gate"
        );

        fs::write(
            &report,
            r#"{"schema_version":1,"gate":"windows_sandbox_admin_execution","status":"failed","generated_at":"2026-05-12T00:00:00.000Z","results":[{"status":"failed"}]}"#,
        )
        .unwrap();
        assert_eq!(super::admin_gate_verified_at(report.to_str()), None);

        fs::write(
            &report,
            r#"{"schema_version":1,"gate":"windows_sandbox_admin_execution","status":"passed","generated_at":"2026-05-12T00:00:00.000Z","results":[]}"#,
        )
        .unwrap();
        assert_eq!(super::admin_gate_verified_at(report.to_str()), None);

        fs::write(
            &report,
            r#"{"schema_version":1,"gate":"windows_sandbox_admin_execution","status":"passed","generated_at":"2026-05-12T00:00:00.000Z","results":[{"status":"passed"}]}"#,
        )
        .unwrap();
        assert_eq!(
            super::admin_gate_verified_at(report.to_str()),
            Some("2026-05-12T00:00:00.000Z".to_string())
        );
    }

    #[cfg(windows)]
    #[test]
    fn wfp_filter_specs_are_table_driven() {
        let specs = super::wfp_filter_specs();

        assert_eq!(specs.len(), 4);
        assert!(specs
            .iter()
            .any(|spec| spec.description.contains("outbound IPv4")));
        assert!(specs
            .iter()
            .any(|spec| spec.description.contains("inbound IPv6")));
    }

    #[test]
    fn probe_network_policy_list_matches_network_enforcement() {
        let probe = super::probe();
        assert_eq!(
            probe.network_enforced,
            probe
                .network_policies_enforced
                .iter()
                .any(|policy| policy == "none")
        );
        assert!(!probe
            .network_policies_enforced
            .iter()
            .any(|policy| policy == "loopback"));
    }

    #[test]
    fn probe_filesystem_enforcement_requires_apply_gate() {
        if !super::restricted_token_launch_supported() {
            assert!(!super::probe().filesystem_enforced);
            return;
        }
        let previous_mode = std::env::var(super::ACL_APPLY_MODE_ENV).ok();
        std::env::remove_var(super::ACL_APPLY_MODE_ENV);
        assert!(!super::probe().filesystem_enforced);
        std::env::set_var(super::ACL_APPLY_MODE_ENV, "apply");
        assert!(super::probe().filesystem_enforced);
        match previous_mode {
            Some(value) => std::env::set_var(super::ACL_APPLY_MODE_ENV, value),
            None => std::env::remove_var(super::ACL_APPLY_MODE_ENV),
        }
    }

    #[test]
    fn setup_status_matches_probe_state() {
        let probe = super::probe();
        let status = super::setup("status");
        assert!(status.ok);
        assert_eq!(status.setup_installed, probe.setup_installed);
        assert_eq!(status.setup_required, probe.setup_required);
        assert_eq!(status.setup_version, probe.setup_version);
        assert_eq!(status.readiness, probe.readiness);
        assert_eq!(
            status.admin_verification_required,
            probe.admin_verification_required
        );
        assert_eq!(status.admin_gate_report_path, probe.admin_gate_report_path);
        assert_eq!(status.admin_gate_verified_at, probe.admin_gate_verified_at);
        assert_eq!(
            status.restricted_token_supported,
            probe.restricted_token_supported
        );
        assert_eq!(status.elevated, probe.elevated);
        assert_eq!(status.filesystem_enforced, probe.filesystem_enforced);
        assert_eq!(status.network_enforced, probe.network_enforced);
        assert_eq!(
            status.network_policies_enforced,
            probe.network_policies_enforced
        );
        assert_eq!(status.filesystem_ready, probe.filesystem_ready);
        assert_eq!(status.network_ready, probe.network_ready);
    }

    #[test]
    fn probe_reports_helper_sha256() {
        let value = super::probe()
            .helper_sha256
            .expect("helper sha256 should be available for the running helper binary");
        assert_eq!(value.len(), 64);
        assert!(value.chars().all(|item| item.is_ascii_hexdigit()));
    }

    #[test]
    fn setup_install_and_uninstall_require_opt_in() {
        if std::env::var(RUN_WINDOWS_WFP_TESTS_ENV).as_deref() != Ok("1") {
            return;
        }
        if !cfg!(windows) {
            return;
        }
        if !super::process_is_elevated() {
            let install = super::setup("install");
            assert!(!install.ok);
            assert!(install.setup_required);
            assert!(install
                .setup_reason
                .unwrap_or_default()
                .contains("requires elevated"));
            return;
        }

        with_wfp_setup_restored(|| {
            assert_wfp_setup_installs();
            assert_wfp_setup_status_installed();
            assert_wfp_setup_uninstalls();
            assert_wfp_setup_status_missing();
            assert_wfp_setup_installs();
            assert_wfp_setup_status_installed();
        });
    }

    #[test]
    fn wfp_setup_allows_full_network_and_blocks_none_policy_loopback_connect() {
        if std::env::var(RUN_WINDOWS_WFP_TESTS_ENV).as_deref() != Ok("1") {
            return;
        }
        if !cfg!(windows) || !super::process_is_elevated() {
            return;
        }

        with_wfp_setup_restored(|| {
            assert!(exec_loopback_connection_attempt("full"));
            assert!(!exec_loopback_connection_attempt("none"));
        });
    }
}
