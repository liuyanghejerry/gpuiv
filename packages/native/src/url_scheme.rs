//! Run-time URL-scheme registration for the platforms whose GPUI port
//! returns `unimplemented` (`gpui_windows` / `gpui_linux`): per-user
//! registry keys on Windows, an XDG desktop entry on Linux — the same
//! per-user story the packager's `register` command installs at packaging
//! time, run from the app process with `current_exe()`.
//!
//! GPUI stays untouched: OS handler registration is not GPUI-owned state,
//! and delivery (`on_open_urls`) is already implemented by both platform
//! ports — only the claim call was missing.

#[cfg(target_os = "linux")]
use std::io;
#[cfg(target_os = "linux")]
use std::path::PathBuf;

/// A scheme name the OS will accept in a class key / MimeType entry.
/// Rejects anything that could smuggle a registry path or a semicolon.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn valid_scheme(scheme: &str) -> bool {
    let mut chars = scheme.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

// ── Windows ──────────────────────────────────────────────────────────

/// `reg add` argument lists for one scheme, in write order. `reg.exe`
/// rather than the windows crate: no new dependency, and the packager
/// writes the identical keys at packaging time.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn windows_reg_args(scheme: &str, exe: &str) -> Vec<Vec<String>> {
    let class = format!("HKCU\\Software\\Classes\\{scheme}");
    [
        ("", &format!("URL:{scheme} protocol")[..]),
        ("URL Protocol", ""),
    ]
    .iter()
    .map(|(name, data)| reg_add(&class, name, data))
    .chain([
        reg_add(&format!("{class}\\DefaultIcon"), "", &format!("\"{exe}\",0")),
        reg_add(
            &format!("{class}\\shell\\open\\command"),
            "",
            &format!("\"{exe}\" \"%1\""),
        ),
    ])
    .collect()
}

fn reg_add(key: &str, name: &str, data: &str) -> Vec<String> {
    let mut args = vec!["add".to_string(), key.to_string()];
    if name.is_empty() {
        args.push("/ve".to_string());
    } else {
        args.push("/v".to_string());
        args.push(name.to_string());
    }
    args.push("/t".to_string());
    args.push("REG_SZ".to_string());
    args.push("/d".to_string());
    args.push(data.to_string());
    args.push("/f".to_string());
    args
}

#[cfg(target_os = "windows")]
pub fn register(scheme: &str) -> Result<(), String> {
    if !valid_scheme(scheme) {
        return Err(format!("invalid URL scheme name: {scheme:?}"));
    }
    let exe = std::env::current_exe()
        .map_err(|error| format!("current_exe failed: {error}"))?
        .to_string_lossy()
        .into_owned();
    for args in windows_reg_args(scheme, &exe) {
        let output = std::process::Command::new("reg")
            .args(&args)
            .output()
            .map_err(|error| format!("reg.exe failed to start: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "reg add failed ({}): {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    }
    // Candidate registration only: the default-protocol claim is the user's
    // confirmation — Windows hash-protects protocol UserChoice.
    Ok(())
}

// ── Linux ────────────────────────────────────────────────────────────

/// The `x-scheme-handler/<scheme>` MimeType entry.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn scheme_mime(scheme: &str) -> String {
    format!("x-scheme-handler/{scheme}")
}

/// Merge the scheme handler into an existing desktop entry's MimeType line
/// (idempotent), or note that a fresh entry is needed. Returns the new
/// file content when a merge happened.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn merge_desktop_entry(content: &str, scheme: &str) -> String {
    let handler = scheme_mime(scheme);
    let mut merged = String::with_capacity(content.len() + handler.len() + 2);
    let mut seen_mime = false;
    for line in content.lines() {
        if let Some(existing) = line.strip_prefix("MimeType=") {
            seen_mime = true;
            if existing.split(';').any(|entry| entry == handler) {
                merged.push_str(line);
            } else {
                let trimmed = existing.trim_end_matches(';');
                merged.push_str(&format!("MimeType={trimmed};{handler};"));
            }
        } else {
            merged.push_str(line);
        }
        merged.push('\n');
    }
    if !seen_mime {
        // Insert after the section header so the key stays inside it.
        let mut positioned = String::with_capacity(merged.len() + handler.len() + 20);
        for line in merged.lines() {
            positioned.push_str(line);
            positioned.push('\n');
            if line.trim() == "[Desktop Entry]" {
                positioned.push_str(&format!("MimeType={handler};\n"));
            }
        }
        return positioned;
    }
    merged
}

#[cfg(target_os = "linux")]
pub fn register(scheme: &str) -> Result<(), String> {
    if !valid_scheme(scheme) {
        return Err(format!("invalid URL scheme name: {scheme:?}"));
    }
    let exe = std::env::current_exe().map_err(|error| format!("current_exe failed: {error}"))?;
    let stem = exe
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .ok_or_else(|| "current_exe has no file stem".to_string())?;
    let home = std::env::var("HOME").map_err(|_| "HOME is unset".to_string())?;
    let applications = PathBuf::from(&home).join(".local/share/applications");
    std::fs::create_dir_all(&applications).map_err(|error| format!("mkdir failed: {error}"))?;
    let desktop_name = format!("{stem}.desktop");
    let desktop_path = applications.join(&desktop_name);

    let handler = scheme_mime(scheme);
    let content = match std::fs::read_to_string(&desktop_path) {
        Ok(existing) => merge_desktop_entry(&existing, scheme),
        Err(error) if error.kind() == io::ErrorKind::NotFound => format!(
            "[Desktop Entry]\nType=Application\nName={stem}\nExec=\"{}\" %f\nTerminal=false\nMimeType={handler};\n",
            exe.display()
        ),
        Err(error) => return Err(format!("read {} failed: {error}", desktop_path.display())),
    };
    std::fs::write(&desktop_path, content).map_err(|error| format!("write failed: {error}"))?;

    // Claiming the default handler is the point of the call; a missing
    // xdg-mime is an error, not a warning.
    let claim = std::process::Command::new("xdg-mime")
        .args(["default", &desktop_name, &handler])
        .status()
        .map_err(|error| format!("xdg-mime failed to start: {error}"))?;
    if !claim.success() {
        return Err(format!("xdg-mime default {desktop_name} {handler} failed"));
    }
    let _ = std::process::Command::new("update-desktop-database")
        .arg(&applications)
        .status();
    Ok(())
}

/// On every other host (macOS uses GPUI's platform implementation) this is
/// dead code the macOS build warns about.
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
#[allow(dead_code)]
pub fn register(_scheme: &str) -> Result<(), String> {
    Err("URL scheme registration is only implemented on Windows and Linux".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheme_validation() {
        assert!(valid_scheme("notes"));
        assert!(valid_scheme("md-notes"));
        assert!(valid_scheme("a+b.c-d"));
        assert!(!valid_scheme("1abc"));
        assert!(!valid_scheme("notes evil"));
        assert!(!valid_scheme("notes;drop"));
        assert!(!valid_scheme(""));
        assert!(!valid_scheme("notes\\path"));
    }

    #[test]
    fn reg_args_write_the_url_protocol_marker() {
        let args = windows_reg_args("notes", "C:\\Apps\\Notes.exe");
        assert_eq!(args.len(), 4);
        let marker = &args[1];
        assert!(marker.contains(&"URL Protocol".to_string()));
        let command = &args[3];
        assert!(command.contains(&"HKCU\\Software\\Classes\\notes\\shell\\open\\command".to_string()));
        assert!(command.contains(&"\"C:\\Apps\\Notes.exe\" \"%1\"".to_string()));
    }

    #[test]
    fn desktop_merge_is_idempotent_and_appends() {
        let base = "[Desktop Entry]\nType=Application\nName=App\nMimeType=text/markdown;\n";
        let once = merge_desktop_entry(base, "notes");
        assert!(once.contains("MimeType=text/markdown;x-scheme-handler/notes;"));
        let twice = merge_desktop_entry(&once, "notes");
        assert_eq!(once, twice, "merging an existing handler must not duplicate it");

        let without_mime = "[Desktop Entry]\nType=Application\nName=App\n";
        let fresh = merge_desktop_entry(without_mime, "notes");
        assert!(fresh.contains("MimeType=x-scheme-handler/notes;"));
        assert!(fresh.find("[Desktop Entry]").unwrap() < fresh.find("MimeType=").unwrap());
    }
}
