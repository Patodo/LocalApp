//! 跨平台子进程组管理工具。
//!
//! 提供 `configure_process_group`（为 tokio Command 设置独立进程组）
//! 和 `ProcessTree`（按进程组/job 整体终止子进程树），
//! 供 runner（node localapp-runner）和 agent（外部 agent CLI）共用。

use tokio::process::Command;

/// 为子进程设置独立进程组（unix）/ Job Object（windows）的准备钩子。
///
/// 在 `Command` spawn 之前调用。unix 上设置 `process_group(0)` 让子进程
/// 成为新进程组 leader，便于后续整组信号清理。
#[cfg(unix)]
pub fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.as_std_mut().process_group(0);
}

#[cfg(not(unix))]
pub fn configure_process_group(_command: &mut Command) {}

/// 已 attach 到子进程的进程树句柄，Drop 或 `terminate_and_reap` 时整组终止。
#[cfg(unix)]
pub struct ProcessTree {
    process_group_id: i32,
}

#[cfg(unix)]
impl ProcessTree {
    /// 在 child spawn 后调用，记录其进程组 id。
    pub fn attach(child: &tokio::process::Child) -> std::io::Result<Self> {
        let process_group_id = child
            .id()
            .ok_or_else(|| std::io::Error::other("child process ID unavailable"))?
            as i32;
        Ok(Self { process_group_id })
    }

    /// 向整个进程组发 SIGKILL 并 reap 子进程。
    pub async fn terminate_and_reap(self, child: &mut tokio::process::Child) {
        unsafe {
            libc::kill(-self.process_group_id, libc::SIGKILL);
        }
        let _ = child.wait().await;
    }
}

#[cfg(windows)]
pub struct ProcessTree {
    job: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl ProcessTree {
    pub fn attach(child: &tokio::process::Child) -> std::io::Result<Self> {
        use std::mem::{size_of, zeroed};
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };

        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut information: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(information).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        let process = child
            .raw_handle()
            .ok_or_else(|| std::io::Error::other("child process handle unavailable"))?
            .cast();
        let assigned = configured != 0 && unsafe { AssignProcessToJobObject(job, process) } != 0;
        if !assigned {
            let error = std::io::Error::last_os_error();
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(job);
            }
            return Err(error);
        }
        Ok(Self { job })
    }

    pub async fn terminate_and_reap(self, child: &mut tokio::process::Child) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job, 1);
        }
        let _ = child.wait().await;
    }
}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

#[cfg(not(any(unix, windows)))]
pub struct ProcessTree;

#[cfg(not(any(unix, windows)))]
impl ProcessTree {
    pub fn attach(_child: &tokio::process::Child) -> std::io::Result<Self> {
        Ok(Self)
    }

    pub async fn terminate_and_reap(self, child: &mut tokio::process::Child) {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}
