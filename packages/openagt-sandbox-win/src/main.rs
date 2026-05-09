use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{self, Read};
#[cfg(not(windows))]
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const HELPER_PROTOCOL_VERSION: u32 = 1;
const SETUP_VERSION: &str = "0";
const ACL_APPLY_MODE_ENV: &str = "OPENAGT_SANDBOX_WINDOWS_APPLY_ACL";

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
    windows_build: Option<String>,
    restricted_token_supported: bool,
    job_object_supported: bool,
    wfp_supported: bool,
    setup_installed: bool,
    setup_version: String,
    setup_required: bool,
    setup_reason: Option<String>,
    filesystem_enforced: bool,
    network_enforced: bool,
    capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
struct SetupOutput {
    ok: bool,
    mode: String,
    setup_installed: bool,
    setup_version: String,
    setup_required: bool,
    setup_reason: Option<String>,
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

fn probe() -> ProbeOutput {
    let restricted_token_supported = restricted_token_launch_supported();
    let filesystem_enforced =
        restricted_token_supported && acl_apply_mode_from_env() == FilesystemAclApplyMode::Apply;
    let setup_reason = if !restricted_token_supported {
        "Restricted token launch privilege is not available in this helper process"
    } else if !filesystem_enforced {
        "Filesystem ACL enforcement is available only when OPENAGT_SANDBOX_WINDOWS_APPLY_ACL=apply is explicitly set"
    } else {
        "WFP network enforcement setup is not installed in this helper build"
    };
    let capabilities = [
        Some("probe".to_string()),
        Some("exec".to_string()),
        cfg!(windows).then(|| "job-object".to_string()),
        Some("path-preflight".to_string()),
        restricted_token_supported.then(|| "restricted-token".to_string()),
        filesystem_enforced.then(|| "filesystem-acl-enforcement".to_string()),
        Some("setup-status".to_string()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    ProbeOutput {
        helper_version: env!("CARGO_PKG_VERSION").to_string(),
        helper_protocol_version: HELPER_PROTOCOL_VERSION,
        windows_build: windows_build(),
        restricted_token_supported,
        job_object_supported: cfg!(windows),
        wfp_supported: cfg!(windows),
        setup_installed: filesystem_enforced,
        setup_version: SETUP_VERSION.to_string(),
        setup_required: !filesystem_enforced,
        setup_reason: Some(setup_reason.to_string()),
        filesystem_enforced,
        network_enforced: false,
        capabilities,
    }
}

fn setup(mode: &str) -> SetupOutput {
    let status = probe();
    let setup_reason = match mode {
        "status" => status.setup_reason,
        "install" => Some(
            "Windows WFP setup install is not implemented in this helper build; no machine state was changed"
                .to_string(),
        ),
        "uninstall" => Some(
            "Windows WFP setup uninstall is not implemented in this helper build; no machine state was changed"
                .to_string(),
        ),
        _ => Some("Unknown Windows sandbox setup mode".to_string()),
    };
    SetupOutput {
        ok: mode == "status",
        mode: mode.to_string(),
        setup_installed: status.setup_installed,
        setup_version: status.setup_version,
        setup_required: status.setup_required,
        setup_reason,
    }
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
            enforced: filesystem_enforced,
            filesystem_enforced,
            network_enforced: false,
            windows_sandbox_mode: if filesystem_enforced {
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
    use std::path::PathBuf;

    const RUN_WINDOWS_ACL_TESTS_ENV: &str = "OPENAGT_RUN_WINDOWS_ACL_TESTS";

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
    fn probe_does_not_claim_network_enforcement() {
        assert!(!super::probe().network_enforced);
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
    }

    #[test]
    fn setup_install_and_uninstall_are_explicit_noops() {
        let install = super::setup("install");
        let uninstall = super::setup("uninstall");
        assert!(!install.ok);
        assert!(!uninstall.ok);
        assert!(install.setup_reason.unwrap().contains("not implemented"));
        assert!(uninstall.setup_reason.unwrap().contains("not implemented"));
    }
}
