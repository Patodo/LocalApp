pub fn script_invokes_localapp_dev(script: &str) -> bool {
    let words = shell_words(script);
    words
        .windows(2)
        .any(|pair| is_localapp_command(&pair[0]) && pair[1] == "dev")
}

fn is_localapp_command(word: &str) -> bool {
    let normalized = word.replace('\\', "/");
    let command = normalized.rsplit('/').next().unwrap_or(word);
    let command = command
        .strip_suffix(".cmd")
        .or_else(|| command.strip_suffix(".exe"))
        .unwrap_or(command);
    command == "localapp"
}

fn shell_words(script: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for ch in script.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        if ch == '\\' {
            escaped = true;
            continue;
        }

        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }

        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }

        if ch.is_whitespace() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            continue;
        }

        current.push(ch);
    }

    if !current.is_empty() {
        words.push(current);
    }

    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_plain_localapp_dev() {
        assert!(script_invokes_localapp_dev("localapp dev"));
    }

    #[test]
    fn detects_localapp_dev_with_arguments() {
        assert!(script_invokes_localapp_dev("localapp dev --host 0.0.0.0"));
    }

    #[test]
    fn detects_localapp_dev_after_env_wrapper() {
        assert!(script_invokes_localapp_dev(
            "cross-env NODE_ENV=development localapp dev",
        ));
    }

    #[test]
    fn detects_windows_localapp_command() {
        assert!(script_invokes_localapp_dev("localapp.cmd dev"));
    }

    #[test]
    fn ignores_quoted_text() {
        assert!(!script_invokes_localapp_dev("echo \"localapp dev\""));
    }

    #[test]
    fn ignores_unrelated_dev_scripts() {
        assert!(!script_invokes_localapp_dev("vite --host 127.0.0.1"));
    }
}
