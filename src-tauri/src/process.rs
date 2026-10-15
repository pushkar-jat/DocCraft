//! Runs local conversion engines safely: explicit argument arrays (never a shell),
//! no console window, a timeout, and cancellation that kills the whole process tree.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug)]
pub enum RunError {
    Spawn,
    Cancelled,
    TimedOut,
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A command with stdio detached and (on Windows) no console window.
pub fn quiet_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Runs a short command and returns its stdout, or None if it fails or exceeds `timeout`.
pub fn capture_stdout(program: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let mut command = quiet_command(program);
    command.args(args).stdout(Stdio::piped());
    let mut child = command.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut text = String::new();
        let _ = std::io::Read::read_to_string(&mut stdout, &mut text);
        text
    });
    let never = AtomicBool::new(false);
    let status = wait(&mut child, timeout, &never).ok()?;
    let text = reader.join().ok()?;
    status.success().then_some(text)
}

/// Spawns `command` and waits for it, honouring `cancel` and `timeout`.
pub fn run(mut command: Command, timeout: Duration, cancel: &AtomicBool) -> Result<ExitStatus, RunError> {
    let mut child = command.spawn().map_err(|_| RunError::Spawn)?;
    wait(&mut child, timeout, cancel)
}

fn wait(child: &mut Child, timeout: Duration, cancel: &AtomicBool) -> Result<ExitStatus, RunError> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(_) => {
                kill_tree(child);
                return Err(RunError::Spawn);
            }
        }
        if cancel.load(Ordering::SeqCst) {
            kill_tree(child);
            return Err(RunError::Cancelled);
        }
        if started.elapsed() > timeout {
            kill_tree(child);
            return Err(RunError::TimedOut);
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn kill_tree(child: &mut Child) {
    // LibreOffice's soffice.exe starts soffice.bin as a child, so kill the whole tree.
    // The PID comes from our own child process, never from user input.
    #[cfg(windows)]
    {
        if let Some(taskkill) = system32_tool("taskkill.exe") {
            let pid = child.id().to_string();
            let _ = quiet_command(&taskkill).args(["/PID", pid.as_str(), "/T", "/F"]).status();
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(windows)]
fn system32_tool(name: &str) -> Option<PathBuf> {
    let root = std::env::var_os("SystemRoot")?;
    let path = PathBuf::from(root).join("System32").join(name);
    path.is_file().then_some(path)
}

/// Creates a private temp folder, runs `work` in it, then deletes it on every outcome.
/// Deletion is retried for a few seconds because a just-killed engine can briefly keep
/// files open; the folder holds a copy of the user's document, so it must not be left behind.
pub fn with_temp_dir<T, E: From<std::io::Error>>(prefix: &str, work: impl FnOnce(&Path) -> Result<T, E>) -> Result<T, E> {
    let dir = tempfile::Builder::new().prefix(prefix).tempdir()?;
    let path = dir.keep();
    let result = work(&path);
    for _ in 0..40 {
        if std::fs::remove_dir_all(&path).is_ok() || !path.exists() {
            break;
        }
        thread::sleep(Duration::from_millis(250));
    }
    result
}

/// Returns the first existing file among `candidates`, then searches PATH for `names`.
pub fn find_executable(candidates: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    if let Some(found) = candidates.iter().find(|path| path.is_file()) {
        return Some(found.clone());
    }
    let path_var = std::env::var_os("PATH")?;
    std::env::split_paths(&path_var)
        .filter(|dir| dir.is_absolute())
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_executable_prefers_existing_candidates() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("tool.exe");
        std::fs::write(&file, b"x").unwrap();
        let missing = dir.path().join("missing.exe");
        assert_eq!(find_executable(&[missing, file.clone()], &[]), Some(file));
    }

    #[test]
    fn temp_dir_is_removed_on_success_and_failure() {
        let mut seen = None;
        let ok: Result<u8, std::io::Error> = with_temp_dir("doccraft-test-", |dir| {
            std::fs::write(dir.join("copy.bin"), b"secret")?;
            seen = Some(dir.to_path_buf());
            Ok(1)
        });
        assert_eq!(ok.unwrap(), 1);
        assert!(!seen.take().unwrap().exists());

        let failed: Result<u8, std::io::Error> = with_temp_dir("doccraft-test-", |dir| {
            std::fs::write(dir.join("copy.bin"), b"secret")?;
            seen = Some(dir.to_path_buf());
            Err(std::io::Error::other("engine failed"))
        });
        assert!(failed.is_err());
        assert!(!seen.unwrap().exists());
    }

    #[test]
    fn find_executable_returns_none_when_nothing_matches() {
        assert_eq!(find_executable(&[], &["definitely-not-a-real-tool-doccraft.exe"]), None);
    }
}
