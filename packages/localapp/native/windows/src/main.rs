//! Windows owns only URI/App Notification activation and atomic Job ownership.
//! It never evaluates Scheme data, hosts LocalApp, or executes action scripts.

#[cfg(windows)]
mod platform {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JobObjectExtendedLimitInformation};
    use windows_sys::Win32::System::Threading::{CreateProcessW, ResumeThread, TerminateProcess, WaitForSingleObject, PROCESS_INFORMATION, STARTUPINFOW, CREATE_SUSPENDED};

    fn wide(value: &str) -> Vec<u16> { OsStr::new(value).encode_wide().chain(once(0)).collect() }

    /// Suspended create -> kill-on-close Job assignment -> resume. Any failure
    /// terminates the root before a partially owned process can escape.
    pub unsafe fn job_owner(command: String) -> Result<(), String> {
        let mut command_line = wide(&command);
        let mut startup: STARTUPINFOW = std::mem::zeroed();
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        let mut process: PROCESS_INFORMATION = std::mem::zeroed();
        if CreateProcessW(null(), command_line.as_mut_ptr(), null(), null(), 1, CREATE_SUSPENDED, null(), null(), &startup, &mut process) == 0 {
            return Err("suspended create failed".into());
        }
        let job: HANDLE = CreateJobObjectW(null(), null());
        if job == 0 { TerminateProcess(process.hProcess, 1); CloseHandle(process.hThread); CloseHandle(process.hProcess); return Err("job create failed".into()); }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) == 0
            || AssignProcessToJobObject(job, process.hProcess) == 0 || ResumeThread(process.hThread) == u32::MAX {
            TerminateProcess(process.hProcess, 1); CloseHandle(job); CloseHandle(process.hThread); CloseHandle(process.hProcess); return Err("atomic job ownership failed".into());
        }
        CloseHandle(process.hThread);
        WaitForSingleObject(process.hProcess, u32::MAX);
        CloseHandle(process.hProcess); CloseHandle(job);
        Ok(())
    }
}

#[cfg(windows)]
fn main() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("--job-owner") && args.next().as_deref() == Some("--") {
        let command = args.collect::<Vec<_>>().join(" ");
        if command.is_empty() || unsafe { platform::job_owner(command) }.is_err() { std::process::exit(1); }
        return;
    }
    // URI/App Notification payloads are opaque and forwarded by the packaged
    // IPC client. Policy intentionally stays in the Node daemon.
    std::process::exit(1);
}

#[cfg(not(windows))]
fn main() { std::process::exit(1); }
