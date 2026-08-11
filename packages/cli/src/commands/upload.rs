use crate::client::collect_files;
use crate::platform_capabilities::embedded_platform_capabilities;
use crate::project::{Manifest, ManifestBackend};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
pub(crate) fn collect_declared_backend_mutations(
    backend_files: &[(String, Vec<u8>)],
) -> Result<Vec<String>, String> {
    let mut mutations = Vec::new();
    for (filename, data) in backend_files {
        if !filename.replace('\\', "/").ends_with("/mutations.json")
            && filename.replace('\\', "/") != "mutations.json"
        {
            continue;
        }
        let value: serde_json::Value = serde_json::from_slice(data)
            .map_err(|e| format!("Invalid backend mutations file {filename}: {e}"))?;
        let Some(entries) = value.get("mutations").and_then(|value| value.as_object()) else {
            continue;
        };
        mutations.extend(entries.keys().cloned());
    }
    mutations.sort();
    mutations.dedup();
    Ok(mutations)
}

pub(crate) fn collect_backend_files_for_manifest(
    project_dir: &Path,
    manifest: &Manifest,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    match &manifest.backend {
        Some(backend)
            if backend
                .include
                .as_ref()
                .is_some_and(|include| !include.is_empty()) =>
        {
            collect_backend_files_by_include(project_dir, backend)
        }
        Some(backend) => {
            let root = backend.root.as_deref().unwrap_or("backend");
            collect_backend_files_from_root(project_dir, root, true)
        }
        None => collect_backend_files_from_root(project_dir, "backend", false),
    }
}

fn collect_backend_files_from_root(
    project_dir: &Path,
    root: &str,
    required: bool,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let Some(root_path) = resolve_project_directory(project_dir, root, "backend root", required)?
    else {
        return Ok(Vec::new());
    };
    let mut files = Vec::new();
    collect_backend_files_recursive_with_project(project_dir, &root_path, &mut files, true)?;
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(files)
}

fn collect_backend_files_by_include(
    project_dir: &Path,
    backend: &ManifestBackend,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let include = backend.include.as_deref().unwrap_or(&[]);
    for pattern in include {
        validate_backend_include_pattern(pattern)?;
    }
    let mut project_files = Vec::new();
    collect_backend_files_recursive_with_project(
        project_dir,
        project_dir,
        &mut project_files,
        false,
    )?;
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    for pattern in include {
        let matches = project_files
            .iter()
            .filter(|(path, _)| glob_matches(pattern, path))
            .cloned()
            .collect::<Vec<_>>();
        if matches.is_empty() {
            return Err(format!(
                "backend.include pattern did not match any backend contract files: {pattern}"
            ));
        }
        for file in matches {
            if seen.insert(file.0.clone()) {
                files.push(file);
            }
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(files)
}

fn collect_backend_files_recursive_with_project(
    project_dir: &Path,
    current: &Path,
    files: &mut Vec<(String, Vec<u8>)>,
    reject_symlink_directories: bool,
) -> Result<(), String> {
    let entries =
        fs::read_dir(current).map_err(|e| format!("Failed to read backend directory: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read backend directory entry: {e}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("Failed to inspect backend path {}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() {
            let relative = relative_project_path(project_dir, &path)?;
            if reject_symlink_directories || is_backend_candidate_file(&path) {
                return Err(format!(
                    "backend source must not contain symlinks: {relative}"
                ));
            }
            continue;
        }
        if metadata.is_dir() {
            collect_backend_files_recursive_with_project(
                project_dir,
                &path,
                files,
                reject_symlink_directories,
            )?;
        } else if metadata.is_file() {
            let relative = relative_project_path(project_dir, &path)?;
            if is_hosted_action_file(&relative) {
                return Err(hosted_actions_disabled_error(&relative));
            }
            if !is_backend_candidate_file(&path) {
                continue;
            }
            if !is_backend_contract_path(&relative) {
                continue;
            }
            let data = fs::read(&path).map_err(|e| format!("Failed to read {relative}: {e}"))?;
            files.push((relative, data));
        }
    }
    Ok(())
}

fn resolve_project_directory(
    project_dir: &Path,
    configured: &str,
    label: &str,
    required: bool,
) -> Result<Option<PathBuf>, String> {
    let configured_path = Path::new(configured);
    if configured.trim().is_empty() || configured_path.is_absolute() {
        return Err(format!(
            "{label} must be a relative path inside the project"
        ));
    }
    let mut relative = PathBuf::new();
    for component in configured_path.components() {
        match component {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "{label} must be a relative path inside the project"
                ));
            }
        }
    }
    if relative.as_os_str().is_empty() {
        return Err(format!("{label} must not resolve to the project root"));
    }

    let mut current = project_dir.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        if !current.exists() {
            if required {
                return Err(format!("{label} does not exist: {configured}"));
            }
            return Ok(None);
        }
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| format!("Failed to inspect {label} {configured}: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("{label} must not contain symlinks: {configured}"));
        }
    }
    if !current.is_dir() {
        return Err(format!("{label} is not a directory: {configured}"));
    }
    let project = project_dir
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project directory: {error}"))?;
    let resolved = current
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {label} {configured}: {error}"))?;
    if !resolved.starts_with(&project) {
        return Err(format!("{label} must stay inside the project"));
    }
    Ok(Some(current))
}

pub(crate) fn collect_package_source_tree(
    project_dir: &Path,
    configured: &str,
    label: &str,
    required: bool,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let Some(root) = resolve_project_directory(project_dir, configured, label, required)? else {
        return Ok(Vec::new());
    };
    let mut files = Vec::new();
    collect_package_source_tree_recursive(&root, &root, label, &mut files)?;
    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(files)
}

fn collect_package_source_tree_recursive(
    root: &Path,
    current: &Path,
    label: &str,
    files: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(current)
        .map_err(|error| format!("Failed to read {label}: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read {label}: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Failed to inspect {label} {}: {error}", path.display()))?;
        let relative = path
            .strip_prefix(root)
            .map_err(|_| format!("{label} file escaped its source directory"))?
            .to_string_lossy()
            .replace('\\', "/");
        if metadata.file_type().is_symlink() {
            return Err(format!("{label} must not contain symlinks: {relative}"));
        }
        if metadata.is_dir() {
            collect_package_source_tree_recursive(root, &path, label, files)?;
        } else if metadata.is_file() {
            files.push((
                relative,
                fs::read(&path).map_err(|error| format!("Failed to read {label} file: {error}"))?,
            ));
        }
    }
    Ok(())
}

fn validate_backend_include_pattern(pattern: &str) -> Result<(), String> {
    let normalized = pattern.replace('\\', "/");
    let path = Path::new(&normalized);
    if normalized.trim().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!(
            "backend.include pattern must stay inside the project: {pattern}"
        ));
    }
    Ok(())
}

pub(crate) fn validate_backend_contract_files(files: &[(String, Vec<u8>)]) -> Result<(), String> {
    let mut resource_names = HashSet::new();
    let mut resource_fields: HashMap<String, HashSet<String>> = HashMap::new();
    let mut named_sql = Vec::new();
    let mut named_sql_contracts: HashMap<String, NamedSqlContract> = HashMap::new();
    let mut action_uses = Vec::new();
    for (path, data) in files {
        if is_hosted_action_file(path) {
            return Err(hosted_actions_disabled_error(path));
        }
        if path.ends_with(".mjs") {
            continue;
        }
        let value: serde_json::Value = serde_json::from_slice(data)
            .map_err(|e| format!("Invalid backend JSON {path}: {e}"))?;
        if path.ends_with("actions.manifest.json") {
            validate_action_manifest(path, &value)?;
            collect_action_uses(path, &value, &mut action_uses)?;
            continue;
        }
        let schema = value
            .get("$schema")
            .and_then(|schema| schema.as_str())
            .ok_or_else(|| format!("Backend contract file {path} must declare $schema"))?;
        match schema {
            "https://localapp.dev/schemas/backend/resource-schema.schema.json" => {
                let Some(name) = value.get("name").and_then(|name| name.as_str()) else {
                    return Err(format!("Backend resource schema {path} must declare name"));
                };
                if !resource_names.insert(name.to_string()) {
                    return Err(format!("Duplicate backend resource schema: {name}"));
                }
                let mut names = value
                    .get("fields")
                    .and_then(|fields| fields.as_object())
                    .map(|fields| fields.keys().cloned().collect::<HashSet<_>>())
                    .unwrap_or_default();
                names.insert("id".to_string());
                resource_fields.insert(name.to_string(), names);
            }
            "https://localapp.dev/schemas/backend/queries.schema.json" => {
                validate_named_sql_file(path, &value, "queries")?;
                collect_named_sql(path, &value, "queries", &mut named_sql)?;
                collect_named_sql_contracts(
                    path,
                    &value,
                    "queries",
                    "query",
                    &mut named_sql_contracts,
                )?;
            }
            "https://localapp.dev/schemas/backend/mutations.schema.json" => {
                validate_named_sql_file(path, &value, "mutations")?;
                collect_named_sql(path, &value, "mutations", &mut named_sql)?;
                collect_named_sql_contracts(
                    path,
                    &value,
                    "mutations",
                    "mutation",
                    &mut named_sql_contracts,
                )?;
            }
            other => return Err(format!("Unsupported backend $schema in {path}: {other}")),
        }
    }
    validate_named_sql_references(&resource_fields, &named_sql)?;
    validate_action_uses(&action_uses, &named_sql_contracts)?;
    Ok(())
}

#[derive(Debug)]
struct NamedSqlContract {
    path: String,
    kind: String,
    sql: String,
    result_mode: Option<String>,
    result_max_rows: Option<u64>,
    result_max_bytes: Option<u64>,
    has_numeric_limit_param: bool,
}

#[derive(Debug)]
struct ActionUses {
    path: String,
    name: String,
    queries: Vec<String>,
    mutations: Vec<String>,
}

fn is_backend_contract_path(relative: &str) -> bool {
    relative.ends_with("/schema.json")
        || relative.ends_with("/queries.json")
        || relative.ends_with("/mutations.json")
        || matches!(relative, "schema.json" | "queries.json" | "mutations.json")
}

fn relative_project_path(project_dir: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(project_dir)
        .map_err(|e| format!("Path error: {e}"))?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn is_hosted_action_file(relative: &str) -> bool {
    relative.ends_with("/actions.manifest.json")
        || relative.ends_with("/actions.bundle.mjs")
        || relative == "actions.manifest.json"
        || relative == "actions.bundle.mjs"
        || is_hosted_action_source(relative)
}

fn is_hosted_action_source(relative: &str) -> bool {
    let normalized = relative.replace('\\', "/");
    let Some(index) = normalized.find("/actions/") else {
        return normalized.starts_with("actions/");
    };
    matches!(
        Path::new(&normalized[index + 1..])
            .extension()
            .and_then(|ext| ext.to_str()),
        Some("ts" | "tsx" | "js" | "mjs")
    )
}

fn hosted_actions_disabled_error(path: &str) -> String {
    format!(
        "Hosted actions are disabled in stable LocalApp backend contracts: {path}. Use named SQL, transaction mutation, or a platform primitive instead."
    )
}

fn is_backend_candidate_file(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(
            "schema.json"
                | "queries.json"
                | "mutations.json"
                | "actions.manifest.json"
                | "actions.bundle.mjs"
        )
    )
}

fn validate_action_manifest(path: &str, value: &serde_json::Value) -> Result<(), String> {
    if value.get("version").and_then(|version| version.as_i64()) != Some(1) {
        return Err(format!("Action manifest {path} must declare version 1"));
    }
    if value
        .get("bundle")
        .and_then(|bundle| bundle.as_str())
        .is_none_or(|bundle| bundle.is_empty())
    {
        return Err(format!("Action manifest {path} must declare bundle"));
    }
    let actions = value
        .get("actions")
        .and_then(|actions| actions.as_array())
        .ok_or_else(|| format!("Action manifest {path} must declare actions array"))?;
    let mut names = HashSet::new();
    for action in actions {
        let name = action
            .get("name")
            .and_then(|name| name.as_str())
            .ok_or_else(|| format!("Action manifest {path} action must declare name"))?;
        if !names.insert(name.to_string()) {
            return Err(format!("Duplicate action name in {path}: {name}"));
        }
        let access = action
            .get("access")
            .and_then(|access| access.as_str())
            .unwrap_or("authenticated");
        if !matches!(access, "public" | "authenticated" | "owner" | "acl") {
            return Err(format!("Invalid action access in {path}: {access}"));
        }
        if action
            .get("exportName")
            .and_then(|export| export.as_str())
            .is_none_or(|export| export.is_empty())
        {
            return Err(format!("Action {name} in {path} must declare exportName"));
        }
        if let Some(input) = action.get("input") {
            validate_action_input_schema(path, name, input)?;
        }
        if !action.get("uses").is_some_and(|uses| uses.is_object()) {
            return Err(format!(
                "Action {name} in {path} must declare uses allowlist"
            ));
        }
    }
    Ok(())
}

fn collect_action_uses(
    path: &str,
    value: &serde_json::Value,
    action_uses: &mut Vec<ActionUses>,
) -> Result<(), String> {
    let actions = value
        .get("actions")
        .and_then(|actions| actions.as_array())
        .ok_or_else(|| format!("Action manifest {path} must declare actions array"))?;
    for action in actions {
        let name = action
            .get("name")
            .and_then(|name| name.as_str())
            .unwrap_or("");
        let uses = action
            .get("uses")
            .and_then(|uses| uses.as_object())
            .ok_or_else(|| format!("Action {name} in {path} must declare uses allowlist"))?;
        action_uses.push(ActionUses {
            path: path.to_string(),
            name: name.to_string(),
            queries: string_array_from_value(uses.get("queries")),
            mutations: string_array_from_value(uses.get("mutations")),
        });
    }
    Ok(())
}

fn string_array_from_value(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToString::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn validate_action_input_schema(
    path: &str,
    name: &str,
    input: &serde_json::Value,
) -> Result<(), String> {
    let schema_type = input
        .get("type")
        .and_then(|kind| kind.as_str())
        .unwrap_or("object");
    if !matches!(
        schema_type,
        "object" | "string" | "number" | "boolean" | "array" | "unknown"
    ) {
        return Err(format!(
            "Invalid action input schema in {path} for {name}: unsupported input type {schema_type}"
        ));
    }
    if let Some(required) = input.get("required") {
        if !required
            .as_array()
            .is_some_and(|items| items.iter().all(|item| item.as_str().is_some()))
        {
            return Err(format!(
                "Invalid action input schema in {path} for {name}: required must be string array"
            ));
        }
    }
    if let Some(properties) = input
        .get("properties")
        .and_then(|properties| properties.as_object())
    {
        for child in properties.values() {
            validate_action_input_schema(path, name, child)?;
        }
    }
    if let Some(items) = input.get("items") {
        validate_action_input_schema(path, name, items)?;
    }
    Ok(())
}

fn glob_matches(pattern: &str, path: &str) -> bool {
    glob_match_parts(
        &pattern.replace('\\', "/").split('/').collect::<Vec<_>>(),
        &path.replace('\\', "/").split('/').collect::<Vec<_>>(),
    )
}

fn glob_match_parts(pattern: &[&str], path: &[&str]) -> bool {
    if pattern.is_empty() {
        return path.is_empty();
    }
    if pattern[0] == "**" {
        return glob_match_parts(&pattern[1..], path)
            || (!path.is_empty() && glob_match_parts(pattern, &path[1..]));
    }
    if path.is_empty() {
        return false;
    }
    segment_matches(pattern[0], path[0]) && glob_match_parts(&pattern[1..], &path[1..])
}

fn segment_matches(pattern: &str, value: &str) -> bool {
    let pattern_chars = pattern.chars().collect::<Vec<_>>();
    let value_chars = value.chars().collect::<Vec<_>>();
    let (mut p, mut v) = (0, 0);
    let mut star: Option<usize> = None;
    let mut star_value = 0;
    while v < value_chars.len() {
        if p < pattern_chars.len() && (pattern_chars[p] == value_chars[v]) {
            p += 1;
            v += 1;
        } else if p < pattern_chars.len() && pattern_chars[p] == '*' {
            star = Some(p);
            star_value = v;
            p += 1;
        } else if let Some(star_index) = star {
            p = star_index + 1;
            star_value += 1;
            v = star_value;
        } else {
            return false;
        }
    }
    while p < pattern_chars.len() && pattern_chars[p] == '*' {
        p += 1;
    }
    p == pattern_chars.len()
}

fn collect_named_sql(
    path: &str,
    value: &serde_json::Value,
    key: &str,
    named_sql: &mut Vec<(String, String, String)>,
) -> Result<(), String> {
    let entries = value
        .get(key)
        .and_then(|entries| entries.as_object())
        .ok_or_else(|| format!("Backend contract file {path} must declare {key} object"))?;
    for (name, entry) in entries {
        if let Some(sql) = entry.get("sql").and_then(|sql| sql.as_str()) {
            named_sql.push((path.to_string(), name.to_string(), sql.to_string()));
        }
    }
    Ok(())
}

fn collect_named_sql_contracts(
    path: &str,
    value: &serde_json::Value,
    key: &str,
    kind: &str,
    named_sql: &mut HashMap<String, NamedSqlContract>,
) -> Result<(), String> {
    let entries = value
        .get(key)
        .and_then(|entries| entries.as_object())
        .ok_or_else(|| format!("Backend contract file {path} must declare {key} object"))?;
    for (name, entry) in entries {
        let sql = entry
            .get("sql")
            .and_then(|sql| sql.as_str())
            .unwrap_or("")
            .to_string();
        let result_mode = entry
            .get("result")
            .and_then(|result| result.get("mode"))
            .and_then(|mode| mode.as_str())
            .map(ToString::to_string);
        let result_max_rows = entry
            .get("result")
            .and_then(|result| result.get("maxRows"))
            .and_then(|max_rows| max_rows.as_u64());
        let result_max_bytes = entry
            .get("result")
            .and_then(|result| result.get("maxBytes"))
            .and_then(|max_bytes| max_bytes.as_u64());
        let has_numeric_limit_param = entry
            .get("params")
            .and_then(|params| params.get("limit"))
            .and_then(|limit| limit.get("type"))
            .and_then(|value| value.as_str())
            == Some("number");
        named_sql.insert(
            name.to_string(),
            NamedSqlContract {
                path: path.to_string(),
                kind: kind.to_string(),
                sql,
                result_mode,
                result_max_rows,
                result_max_bytes,
                has_numeric_limit_param,
            },
        );
    }
    Ok(())
}

fn validate_action_uses(
    actions: &[ActionUses],
    named_sql: &HashMap<String, NamedSqlContract>,
) -> Result<(), String> {
    for action in actions {
        for query in &action.queries {
            let Some(contract) = named_sql.get(query) else {
                return Err(format!(
                    "Action {} in {} references unknown query: {query}",
                    action.name, action.path
                ));
            };
            if contract.kind != "query" {
                return Err(format!(
                    "Action {} in {} references non-query as query: {query}",
                    action.name, action.path
                ));
            }
            validate_action_query_is_bounded(action, query, contract)?;
        }
        for mutation in &action.mutations {
            let Some(contract) = named_sql.get(mutation) else {
                return Err(format!(
                    "Action {} in {} references unknown mutation: {mutation}",
                    action.name, action.path
                ));
            };
            if contract.kind != "mutation" {
                return Err(format!(
                    "Action {} in {} references non-mutation as mutation: {mutation}",
                    action.name, action.path
                ));
            }
        }
    }
    Ok(())
}

fn validate_action_query_is_bounded(
    action: &ActionUses,
    query: &str,
    contract: &NamedSqlContract,
) -> Result<(), String> {
    const PLATFORM_MAX_ROWS: u64 = 1_000;
    const PLATFORM_MAX_BYTES: u64 = 1024 * 1024;

    let Some(mode) = contract.result_mode.as_deref() else {
        return Err(format!(
            "Action {} query {query} in {} must declare bounded result metadata",
            action.name, action.path
        ));
    };
    if !matches!(mode, "page" | "single" | "aggregate" | "bounded") {
        return Err(format!(
            "Named query {query} in {} has unsupported result mode: {mode}",
            contract.path
        ));
    }
    let Some(max_rows) = contract.result_max_rows else {
        return Err(format!(
            "Action {} query {query} in {} must declare result.maxRows",
            action.name, action.path
        ));
    };
    let Some(max_bytes) = contract.result_max_bytes else {
        return Err(format!(
            "Action {} query {query} in {} must declare result.maxBytes",
            action.name, action.path
        ));
    };
    if max_rows == 0 || max_rows > PLATFORM_MAX_ROWS {
        return Err(format!(
            "Named query {query} in {} result.maxRows must be between 1 and {PLATFORM_MAX_ROWS}",
            contract.path
        ));
    }
    if max_bytes == 0 || max_bytes > PLATFORM_MAX_BYTES {
        return Err(format!(
            "Named query {query} in {} result.maxBytes must be between 1 and {PLATFORM_MAX_BYTES}",
            contract.path
        ));
    }
    if mode == "single" && max_rows > 1 {
        return Err(format!(
            "Named query {query} in {} single result must allow at most one row",
            contract.path
        ));
    }
    if mode == "page" {
        if !contract.has_numeric_limit_param {
            return Err(format!(
                "Action {} query {query} in {} must declare numeric limit param",
                action.name, action.path
            ));
        }
        if !contains_sql_keyword(&contract.sql.to_lowercase(), "limit") {
            return Err(format!(
                "Action {} query {query} in {} must use pagination with LIMIT",
                action.name, action.path
            ));
        }
    }
    Ok(())
}

fn validate_named_sql_references(
    resources: &HashMap<String, HashSet<String>>,
    named_sql: &[(String, String, String)],
) -> Result<(), String> {
    if resources.is_empty() {
        return Ok(());
    }
    if resources
        .values()
        .any(|fields| fields.len() <= 1 && fields.contains("id"))
    {
        return Ok(());
    }
    for (path, name, sql) in named_sql {
        let cte_names = extract_cte_names(sql);
        let table_names = extract_sql_table_names(sql);
        for table in &table_names {
            if cte_names.contains(table) {
                continue;
            }
            if !resources.contains_key(table) {
                return Err(format!(
                    "Named SQL {name} in {path} references unknown resource: {table}"
                ));
            }
        }
        let Some(primary_table) = table_names
            .iter()
            .find(|table| resources.contains_key(*table))
        else {
            continue;
        };
        let fields = table_names
            .iter()
            .filter_map(|table| resources.get(table))
            .flat_map(|table_fields| table_fields.iter().cloned())
            .collect::<HashSet<_>>();
        if fields.len() <= 1 && fields.contains("id") {
            continue;
        }
        for field in extract_sql_field_names(sql) {
            if !fields.contains(&field) {
                return Err(format!(
                    "Named SQL {name} in {path} references unknown field {primary_table}.{field}"
                ));
            }
        }
    }
    Ok(())
}

fn validate_named_sql_file(path: &str, value: &serde_json::Value, key: &str) -> Result<(), String> {
    let entries = value
        .get(key)
        .and_then(|entries| entries.as_object())
        .ok_or_else(|| format!("Backend contract file {path} must declare {key} object"))?;
    for (name, entry) in entries {
        let sql = entry
            .get("sql")
            .and_then(|sql| sql.as_str())
            .ok_or_else(|| format!("Named SQL {name} in {path} must declare sql"))?;
        validate_named_sql_params(path, name, sql, entry)?;
        if key == "queries" {
            validate_named_sql_result_contract(path, name, entry)?;
        }
        if key == "queries" && !is_readonly_sql(sql) {
            return Err(format!("Named query {name} in {path} must be read-only"));
        }
        if key == "mutations" && has_dangerous_sql(sql) {
            return Err(format!(
                "Named mutation {name} in {path} contains forbidden SQL"
            ));
        }
    }
    Ok(())
}

fn validate_named_sql_result_contract(
    path: &str,
    name: &str,
    entry: &serde_json::Value,
) -> Result<(), String> {
    let Some(result) = entry.get("result") else {
        return Ok(());
    };
    let result = result
        .as_object()
        .ok_or_else(|| format!("Named SQL {name} result in {path} must be an object"))?;
    let mode = result
        .get("mode")
        .and_then(|value| value.as_str())
        .ok_or_else(|| format!("Named SQL {name} result.mode in {path} is required"))?;
    if !matches!(mode, "page" | "single" | "aggregate" | "bounded") {
        return Err(format!(
            "Named SQL {name} result.mode in {path} must be page, single, aggregate or bounded"
        ));
    }
    let capabilities = embedded_platform_capabilities()?;
    let max_rows = match result.get("maxRows") {
        Some(value) => value.as_u64().filter(|value| *value > 0).ok_or_else(|| {
            format!("Named SQL {name} result.maxRows in {path} must be a positive integer")
        })?,
        None if mode == "single" => 1,
        None => {
            return Err(format!(
                "Named SQL {name} result.maxRows in {path} is required"
            ));
        }
    };
    let max_bytes = match result.get("maxBytes") {
        Some(value) => value.as_u64().filter(|value| *value > 0).ok_or_else(|| {
            format!("Named SQL {name} result.maxBytes in {path} must be a positive integer")
        })?,
        None => capabilities.backend.named_sql.max_bytes,
    };
    if max_rows > capabilities.backend.named_sql.max_rows {
        return Err(format!(
            "Named SQL {name} result.maxRows in {path} must be <= {}",
            capabilities.backend.named_sql.max_rows
        ));
    }
    if max_bytes > capabilities.backend.named_sql.max_bytes {
        return Err(format!(
            "Named SQL {name} result.maxBytes in {path} must be <= {}",
            capabilities.backend.named_sql.max_bytes
        ));
    }
    if mode == "single" && max_rows > 1 {
        return Err(format!(
            "Named SQL {name} single result in {path} must allow at most one row"
        ));
    }
    if mode == "page" {
        let has_numeric_limit = entry
            .get("params")
            .and_then(|params| params.get("limit"))
            .and_then(|limit| limit.get("type"))
            .and_then(|value| value.as_str())
            == Some("number");
        if !has_numeric_limit {
            return Err(format!(
                "Named SQL {name} page result in {path} must declare numeric limit param"
            ));
        }
        let sql = entry
            .get("sql")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if !contains_sql_keyword(&sql.to_lowercase(), "limit") {
            return Err(format!(
                "Named SQL {name} page result SQL in {path} must include LIMIT"
            ));
        }
    }
    Ok(())
}

fn validate_named_sql_params(
    path: &str,
    name: &str,
    sql: &str,
    entry: &serde_json::Value,
) -> Result<(), String> {
    let params = entry
        .get("params")
        .and_then(|params| params.as_object())
        .cloned()
        .unwrap_or_default();
    let placeholders = extract_sql_placeholders(sql);
    let system_params = ["currentUserId", "ownerId", "now"]
        .into_iter()
        .collect::<HashSet<_>>();
    let user_placeholders = placeholders
        .iter()
        .filter(|placeholder| !system_params.contains(placeholder.as_str()))
        .cloned()
        .collect::<HashSet<_>>();
    let declared = params.keys().cloned().collect::<HashSet<_>>();
    let missing = user_placeholders
        .difference(&declared)
        .cloned()
        .collect::<Vec<_>>();
    let unused = declared
        .difference(&user_placeholders)
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() || !unused.is_empty() {
        return Err(format!(
            "Named SQL {name} in {path} params mismatch. Missing declarations: {}; unused declarations: {}",
            if missing.is_empty() {
                "none".to_string()
            } else {
                missing.join(", ")
            },
            if unused.is_empty() {
                "none".to_string()
            } else {
                unused.join(", ")
            },
        ));
    }
    Ok(())
}

fn extract_sql_placeholders(sql: &str) -> HashSet<String> {
    let mut placeholders = HashSet::new();
    let chars = sql.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == ':'
            && index + 1 < chars.len()
            && (chars[index + 1].is_ascii_alphabetic() || chars[index + 1] == '_')
        {
            let start = index + 1;
            let mut end = start + 1;
            while end < chars.len() && (chars[end].is_ascii_alphanumeric() || chars[end] == '_') {
                end += 1;
            }
            placeholders.insert(chars[start..end].iter().collect());
            index = end;
        } else {
            index += 1;
        }
    }
    placeholders
}

fn is_readonly_sql(sql: &str) -> bool {
    let normalized = sql.trim().to_lowercase();
    (normalized.starts_with("select ") || normalized.starts_with("with "))
        && !has_dangerous_sql(sql)
}

fn has_dangerous_sql(sql: &str) -> bool {
    let normalized = sql.to_lowercase();
    normalized
        .split(';')
        .filter(|part| !part.trim().is_empty())
        .count()
        > 1
        || ["drop", "alter", "attach", "detach", "pragma", "create"]
            .iter()
            .any(|keyword| contains_sql_keyword(&normalized, keyword))
}

fn contains_sql_keyword(sql: &str, keyword: &str) -> bool {
    sql.split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .any(|token| token == keyword)
}

fn extract_sql_table_names(sql: &str) -> Vec<String> {
    let normalized = strip_sql_literals(sql);
    let tokens = sql_tokens(&normalized);
    let mut names = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index].to_ascii_lowercase();
        let next = tokens.get(index + 1).cloned();
        if matches!(token.as_str(), "from" | "join" | "update") {
            if let Some(name) = next {
                push_unique(&mut names, name);
            }
            index += 2;
            continue;
        }
        if token == "into" && index > 0 && tokens[index - 1].eq_ignore_ascii_case("insert") {
            if let Some(name) = next {
                push_unique(&mut names, name);
            }
            index += 2;
            continue;
        }
        if token == "from" && index > 0 && tokens[index - 1].eq_ignore_ascii_case("delete") {
            if let Some(name) = next {
                push_unique(&mut names, name);
            }
            index += 2;
            continue;
        }
        index += 1;
    }
    names
}

fn extract_sql_field_names(sql: &str) -> HashSet<String> {
    let normalized = strip_sql_literals(sql);
    let mut fields = HashSet::new();
    if let Some(select_columns) = between_keyword(&normalized, "select", &["from"]) {
        for column in split_sql_list(&select_columns) {
            if let Some(field) = simple_field_reference(&column) {
                fields.insert(field);
            }
        }
    }
    if let Some(insert_columns) = extract_insert_columns(&normalized) {
        for column in split_sql_list(&insert_columns) {
            if let Some(field) = simple_field_reference(&column) {
                fields.insert(field);
            }
        }
    }
    if let Some(set_clause) = between_keyword(&normalized, "set", &["where"]) {
        for assignment in split_sql_list(&set_clause) {
            if let Some((field, _)) = assignment.split_once('=') {
                if let Some(field) = simple_field_reference(field) {
                    fields.insert(field);
                }
            }
        }
    }
    for clause in sql_clauses(&normalized) {
        let tokens = sql_tokens(&clause);
        for pair in tokens.windows(2) {
            let field = &pair[0];
            let op = pair[1].to_ascii_lowercase();
            if matches!(
                op.as_str(),
                "=" | "<>" | "!=" | "<" | ">" | "<=" | ">=" | "in" | "like" | "is"
            ) && !is_sql_keyword(field)
                && !field.starts_with(':')
            {
                fields.insert(field.rsplit('.').next().unwrap_or(field).to_string());
            }
        }
    }
    for clause in sql_list_clauses(&normalized) {
        for field in split_sql_list(&clause) {
            if let Some(field) = simple_field_reference(&field) {
                fields.insert(field);
            }
        }
    }
    fields
}

fn sql_tokens(sql: &str) -> Vec<String> {
    sql.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == ':'))
        .filter(|token| !token.is_empty())
        .map(|token| token.to_string())
        .collect()
}

fn push_unique(values: &mut Vec<String>, value: String) {
    let value = value.rsplit('.').next().unwrap_or(&value).to_string();
    if !values.contains(&value) {
        values.push(value);
    }
}

fn strip_sql_literals(sql: &str) -> String {
    let mut out = String::new();
    let mut in_single = false;
    let mut in_double = false;
    for char in sql.chars() {
        match char {
            '\'' if !in_double => {
                in_single = !in_single;
                out.push(' ');
            }
            '"' if !in_single => {
                in_double = !in_double;
                out.push(' ');
            }
            _ if in_single || in_double => out.push(' '),
            _ => out.push(char),
        }
    }
    out
}

fn extract_cte_names(sql: &str) -> HashSet<String> {
    let tokens = sql_tokens(sql);
    let mut names = HashSet::new();
    if tokens
        .first()
        .is_none_or(|token| !token.eq_ignore_ascii_case("with"))
    {
        return names;
    }
    for window in tokens.windows(2) {
        if window[1].eq_ignore_ascii_case("as") {
            names.insert(window[0].clone());
        }
    }
    names
}

fn split_sql_list(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0_i32;
    for char in value.chars() {
        match char {
            '(' => {
                depth += 1;
                current.push(char);
            }
            ')' => {
                depth = (depth - 1).max(0);
                current.push(char);
            }
            ',' if depth == 0 => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(char),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

fn simple_field_reference(fragment: &str) -> Option<String> {
    let trimmed = fragment.trim();
    if trimmed.is_empty() || trimmed == "*" || trimmed.ends_with(".*") || trimmed.contains('(') {
        return None;
    }
    let without_alias = trimmed
        .split_once(" AS ")
        .map(|(field, _)| field)
        .unwrap_or(trimmed)
        .split_once(" as ")
        .map(|(field, _)| field)
        .unwrap_or(trimmed)
        .split_whitespace()
        .next()
        .unwrap_or(trimmed);
    let field = without_alias.rsplit('.').next().unwrap_or(without_alias);
    if field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && !is_sql_keyword(field) {
        Some(field.to_string())
    } else {
        None
    }
}

fn between_keyword(sql: &str, start: &str, end_keywords: &[&str]) -> Option<String> {
    let lower = sql.to_ascii_lowercase();
    let (_, start_end) = find_sql_keyword(&lower, start, 0)?;
    let start_pos = start_end;
    let mut end_pos = sql.len();
    for end in end_keywords {
        if let Some((pos, _)) = find_sql_keyword(&lower, end, start_pos) {
            end_pos = end_pos.min(pos);
        }
    }
    Some(sql[start_pos..end_pos].trim().to_string())
}

fn find_sql_keyword(sql: &str, keyword: &str, from: usize) -> Option<(usize, usize)> {
    let mut cursor = from;
    while cursor < sql.len() {
        let relative = sql[cursor..].find(keyword)?;
        let start = cursor + relative;
        let end = start + keyword.len();
        if is_sql_keyword_boundary(sql, start, end) {
            return Some((start, end));
        }
        cursor = end;
    }
    None
}

fn is_sql_keyword_boundary(sql: &str, start: usize, end: usize) -> bool {
    let before = start == 0
        || sql[..start]
            .chars()
            .next_back()
            .is_none_or(|c| !is_sql_identifier_char(c));
    let after = end >= sql.len()
        || sql[end..]
            .chars()
            .next()
            .is_none_or(|c| !is_sql_identifier_char(c));
    before && after
}

fn is_sql_identifier_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn extract_insert_columns(sql: &str) -> Option<String> {
    let lower = sql.to_ascii_lowercase();
    let into_pos = lower.find("insert into")?;
    let open = sql[into_pos..].find('(')? + into_pos;
    let close = sql[open + 1..].find(')')? + open + 1;
    Some(sql[open + 1..close].to_string())
}

fn sql_clauses(sql: &str) -> Vec<String> {
    ["where", "group by", "order by"]
        .iter()
        .filter_map(|keyword| {
            between_keyword(sql, keyword, &["group by", "order by", "limit", "offset"])
        })
        .collect()
}

fn sql_list_clauses(sql: &str) -> Vec<String> {
    ["group by", "order by"]
        .iter()
        .filter_map(|keyword| between_keyword(sql, keyword, &["order by", "limit", "offset"]))
        .collect()
}

fn is_sql_keyword(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "and"
            | "or"
            | "not"
            | "null"
            | "true"
            | "false"
            | "is"
            | "in"
            | "like"
            | "between"
            | "case"
            | "when"
            | "then"
            | "else"
            | "end"
            | "asc"
            | "desc"
            | "count"
            | "limit"
            | "offset"
    )
}

pub fn validate_platform_version_range(range: &str) -> Result<(), String> {
    let trimmed = range.trim();
    if trimmed.starts_with('^') && trimmed.len() > 1 {
        return Ok(());
    }
    if trimmed.starts_with(">=") && trimmed.contains('<') {
        return Ok(());
    }
    Err("Invalid platformVersion range".to_string())
}

#[cfg(test)]
fn contains_action_source(dir: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(dir).map_err(|error| format!("Failed to read actions: {error}"))? {
        let path = entry
            .map_err(|error| format!("Failed to read action entry: {error}"))?
            .path();
        if path.is_dir() && contains_action_source(&path)? {
            return Ok(true);
        }
        if matches!(path.extension().and_then(|extension| extension.to_str()), Some("ts" | "tsx" | "js" | "mjs")) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::{
        collect_backend_files_for_manifest, collect_files, contains_action_source,
        validate_backend_contract_files, validate_platform_version_range,
    };
    use crate::project::{Manifest, ManifestBackend};
    use std::fs;
    use tempfile::tempdir;

    fn manifest_with_backend(backend: Option<ManifestBackend>) -> Manifest {
        Manifest {
            name: "test-app".to_string(),
            description: String::new(),
            dist_dir: "dist".to_string(),
            db: None,
            shell: None,
            issues: None,
            notify: None,
            backend,
            collaboration: None,
            business: None,
            requires: None,
            platform_version: Some("^1.0".to_string()),
        }
    }

    #[test]
    fn platform_version_range_accepts_supported_ranges() {
        assert!(validate_platform_version_range("^1.0").is_ok());
        assert!(validate_platform_version_range(">=1.0 <2.0").is_ok());
    }

    #[test]
    fn platform_version_range_rejects_exact_version() {
        assert_eq!(
            validate_platform_version_range("1.0").unwrap_err(),
            "Invalid platformVersion range"
        );
    }

    #[test]
    fn upload_file_collection_excludes_local_issue_database() {
        let project = tempdir().unwrap();
        fs::create_dir_all(project.path().join("dist/assets")).unwrap();
        fs::create_dir_all(project.path().join(".localapp")).unwrap();
        fs::write(project.path().join("dist/index.html"), "<main>app</main>").unwrap();
        fs::write(project.path().join("dist/assets/app.js"), "export {};").unwrap();
        fs::write(project.path().join(".localapp/dev.db"), b"local issues").unwrap();
        fs::create_dir_all(project.path().join(".localapp/issues/attachments")).unwrap();
        fs::write(
            project
                .path()
                .join(".localapp/issues/attachments/attachment-1"),
            b"local issue attachment",
        )
        .unwrap();

        let files = collect_files(&project.path().join("dist")).unwrap();
        let mut names = files.into_iter().map(|(name, _)| name).collect::<Vec<_>>();
        names.sort();

        assert_eq!(names, vec!["assets/app.js", "index.html"]);
        assert!(!names.iter().any(|name| name.contains("dev.db")));
        assert!(!names.iter().any(|name| name.contains("issues/attachments")));
    }

    #[test]
    fn collects_and_validates_backend_contract_files() {
        let dir = tempdir().unwrap();
        let resource = dir.path().join("backend/resources/work_items");
        fs::create_dir_all(&resource).unwrap();
        fs::write(
            resource.join("schema.json"),
            r#"{
          "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
          "name": "work_items",
          "fields": {}
        }"#,
        )
        .unwrap();
        fs::write(
            resource.join("queries.json"),
            r#"{
          "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
          "queries": {
            "work_items.mine": { "kind": "query", "sql": "SELECT * FROM work_items", "params": {} }
          }
        }"#,
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("backend/schemas")).unwrap();
        fs::write(
            dir.path().join("backend/schemas/queries.schema.json"),
            r#"{
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "$id": "https://localapp.dev/schemas/backend/queries.schema.json"
        }"#,
        )
        .unwrap();

        let files =
            collect_backend_files_for_manifest(dir.path(), &manifest_with_backend(None)).unwrap();
        assert_eq!(files.len(), 2);
        assert!(
            files
                .iter()
                .any(|(path, _)| path == "backend/resources/work_items/schema.json")
        );
        assert!(
            !files
                .iter()
                .any(|(path, _)| path == "backend/schemas/queries.schema.json")
        );
        validate_backend_contract_files(&files).unwrap();
    }

    #[test]
    fn rejects_backend_action_manifest_and_bundle_from_backend_root() {
        let dir = tempdir().unwrap();
        let backend = dir.path().join("backend");
        fs::create_dir_all(&backend).unwrap();
        fs::write(backend.join("actions.manifest.json"), r#"{
          "version": 1,
          "bundle": "backend/actions.bundle.mjs",
          "actions": [{
            "name": "work_items.close",
            "exportName": "closeWorkItem",
            "access": "authenticated",
            "input": { "type": "object", "properties": { "id": { "type": "number" } }, "required": ["id"] }
          }]
        }"#).unwrap();
        fs::write(
            backend.join("actions.bundle.mjs"),
            "export const closeWorkItem = { handler() {} };",
        )
        .unwrap();

        let error = collect_backend_files_for_manifest(
            dir.path(),
            &manifest_with_backend(Some(ManifestBackend {
                root: Some("backend".to_string()),
                include: None,
            })),
        )
        .unwrap_err();

        assert!(error.contains("Hosted actions") || error.contains("disabled"));
    }

    #[test]
    fn rejects_hosted_action_files_in_stable_backend_contract() {
        let files = vec![
            (
                "backend/actions.manifest.json".to_string(),
                br#"{
                  "version": 1,
                  "bundle": "backend/actions.bundle.mjs",
                  "actions": []
                }"#
                .to_vec(),
            ),
            (
                "backend/actions.bundle.mjs".to_string(),
                b"export {};".to_vec(),
            ),
        ];

        let error = validate_backend_contract_files(&files).unwrap_err();
        assert!(error.contains("hosted action") || error.contains("disabled"));
    }

    #[test]
    fn detects_backend_action_source_files() {
        let dir = tempdir().unwrap();
        let actions = dir.path().join("backend/actions");
        fs::create_dir_all(&actions).unwrap();
        fs::write(actions.join("work-items.ts"), "export const action = {};").unwrap();

        assert!(contains_action_source(&actions).unwrap());
    }

    #[test]
    fn rejects_backend_action_manifest_before_legacy_validation() {
        let invalid_access = vec![(
            "backend/actions.manifest.json".to_string(),
            br#"{
          "version": 1,
          "bundle": "backend/actions.bundle.mjs",
          "actions": [{
            "name": "work_items.close",
            "exportName": "closeWorkItem",
            "access": "superuser",
            "input": { "type": "object" }
          }]
        }"#
            .to_vec(),
        )];
        assert!(
            validate_backend_contract_files(&invalid_access)
                .unwrap_err()
                .contains("Hosted actions")
        );

        let invalid_input = vec![(
            "backend/actions.manifest.json".to_string(),
            br#"{
          "version": 1,
          "bundle": "backend/actions.bundle.mjs",
          "actions": [{
            "name": "work_items.close",
            "exportName": "closeWorkItem",
            "access": "authenticated",
            "input": { "type": "function" }
          }]
        }"#
            .to_vec(),
        )];
        assert!(
            validate_backend_contract_files(&invalid_input)
                .unwrap_err()
                .contains("Hosted actions")
        );
    }

    #[test]
    fn rejects_action_that_references_unbounded_query_read_model() {
        let files = vec![
            (
                "backend/resources/work_items/schema.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
              "name": "work_items",
              "fields": { "title": { "type": "string" } }
            }"#
                .to_vec(),
            ),
            (
                "backend/resources/work_items/queries.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
              "queries": {
                "work_items.listAll": {
                  "kind": "query",
                  "sql": "SELECT * FROM work_items",
                  "params": {}
                }
              }
            }"#
                .to_vec(),
            ),
            (
                "backend/resources/work_items/mutations.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/mutations.schema.json",
              "mutations": {
                "work_items.close": {
                  "kind": "mutation",
                  "sql": "UPDATE work_items SET title = :title WHERE id = :id",
                  "params": {
                    "id": { "type": "number", "required": true },
                    "title": { "type": "string", "required": true }
                  }
                }
              }
            }"#
                .to_vec(),
            ),
            (
                "backend/actions.manifest.json".to_string(),
                br#"{
              "version": 1,
              "bundle": "backend/actions.bundle.mjs",
              "actions": [{
                "name": "work_items.listRows",
                "exportName": "listRows",
                "access": "authenticated",
                "uses": { "queries": ["work_items.listAll"], "mutations": [] },
                "input": { "type": "object" }
              }]
            }"#
                .to_vec(),
            ),
        ];

        let error = validate_backend_contract_files(&files).unwrap_err();
        assert!(error.contains("Hosted actions") || error.contains("disabled"));
    }

    #[test]
    fn rejects_action_query_result_contracts_that_exceed_cli_bounds() {
        let base_schema = (
            "backend/resources/work_items/schema.json".to_string(),
            br#"{
          "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
          "name": "work_items",
          "fields": { "id": { "type": "number" }, "title": { "type": "string" } }
        }"#
            .to_vec(),
        );
        let action_manifest = (
            "backend/actions.manifest.json".to_string(),
            br#"{
          "version": 1,
          "bundle": "backend/actions.bundle.mjs",
          "actions": [{
            "name": "work_items.listRows",
            "exportName": "listRows",
            "access": "authenticated",
            "uses": { "queries": ["work_items.page"], "mutations": [] },
            "input": { "type": "object" }
          }]
        }"#
            .to_vec(),
        );

        let missing_limit_param = vec![
            base_schema.clone(),
            (
                "backend/resources/work_items/queries.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
              "queries": {
                "work_items.page": {
                  "kind": "query",
                  "sql": "SELECT id, title FROM work_items ORDER BY id DESC LIMIT 50",
                  "params": {},
                  "result": { "mode": "page", "maxRows": 50, "maxBytes": 4096 }
                }
              }
            }"#
                .to_vec(),
            ),
            action_manifest.clone(),
        ];
        assert!(
            validate_backend_contract_files(&missing_limit_param)
                .unwrap_err()
                .contains("numeric limit")
        );

        let excessive_rows = vec![
            base_schema.clone(),
            ("backend/resources/work_items/queries.json".to_string(), br#"{
              "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
              "queries": {
                "work_items.page": {
                  "kind": "query",
                  "sql": "SELECT id, title FROM work_items ORDER BY id DESC LIMIT :limit OFFSET :offset",
                  "params": {
                    "limit": { "type": "number", "required": true },
                    "offset": { "type": "number", "required": true }
                  },
                  "result": { "mode": "page", "maxRows": 1001, "maxBytes": 4096 }
                }
              }
            }"#.to_vec()),
            action_manifest.clone(),
        ];
        assert!(
            validate_backend_contract_files(&excessive_rows)
                .unwrap_err()
                .contains("maxRows")
        );

        let single_multi_row = vec![
            base_schema,
            (
                "backend/resources/work_items/queries.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
              "queries": {
                "work_items.page": {
                  "kind": "query",
                  "sql": "SELECT id, title FROM work_items WHERE id = :id",
                  "params": { "id": { "type": "number", "required": true } },
                  "result": { "mode": "single", "maxRows": 2, "maxBytes": 4096 }
                }
              }
            }"#
                .to_vec(),
            ),
            action_manifest,
        ];
        assert!(
            validate_backend_contract_files(&single_multi_row)
                .unwrap_err()
                .contains("at most one row")
        );
    }

    #[test]
    fn rejects_unreferenced_named_query_result_contracts_that_exceed_platform_bounds() {
        let files = vec![
            (
                "backend/resources/work_items/schema.json".to_string(),
                br#"{
                  "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
                  "name": "work_items",
                  "fields": { "title": { "type": "string" } }
                }"#
                    .to_vec(),
            ),
            (
                "backend/resources/work_items/queries.json".to_string(),
                br#"{
                  "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
                  "queries": {
                    "work_items.list": {
                      "kind": "query",
                      "sql": "SELECT id, title FROM work_items ORDER BY id DESC LIMIT :limit OFFSET :offset",
                      "params": {
                        "limit": { "type": "number", "required": true },
                        "offset": { "type": "number", "required": true }
                      },
                      "result": { "mode": "page", "maxRows": 1001, "maxBytes": 4096 }
                    }
                  }
                }"#
                    .to_vec(),
            ),
        ];

        let error = validate_backend_contract_files(&files).unwrap_err();
        assert!(error.contains("work_items.list"));
        assert!(error.contains("maxRows"));
        assert!(error.contains("1000"));
    }

    #[test]
    fn rejects_action_manifest_without_uses_allowlist() {
        let files = vec![
            (
                "backend/resources/work_items/schema.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
              "name": "work_items",
              "fields": {}
            }"#
                .to_vec(),
            ),
            (
                "backend/actions.manifest.json".to_string(),
                br#"{
              "version": 1,
              "bundle": "backend/actions.bundle.mjs",
              "actions": [{
                "name": "work_items.close",
                "exportName": "closeWorkItem",
                "access": "authenticated",
                "input": { "type": "object" }
              }]
            }"#
                .to_vec(),
            ),
        ];

        assert!(
            validate_backend_contract_files(&files)
                .unwrap_err()
                .contains("Hosted actions")
        );
    }

    #[test]
    fn collects_backend_contract_files_from_manifest_root_and_include() {
        let dir = tempdir().unwrap();
        let resource = dir.path().join("contracts/resources/work_items");
        fs::create_dir_all(&resource).unwrap();
        fs::write(
            resource.join("schema.json"),
            r#"{
          "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
          "name": "work_items",
          "fields": {}
        }"#,
        )
        .unwrap();
        fs::write(
            resource.join("queries.json"),
            r#"{
          "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
          "queries": {}
        }"#,
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("contracts/schemas")).unwrap();
        fs::write(
            dir.path().join("contracts/schemas/queries.schema.json"),
            "{}",
        )
        .unwrap();

        let root_manifest = manifest_with_backend(Some(ManifestBackend {
            root: Some("contracts".to_string()),
            include: None,
        }));
        let root_files = collect_backend_files_for_manifest(dir.path(), &root_manifest).unwrap();
        assert!(
            root_files
                .iter()
                .any(|(path, _)| path == "contracts/resources/work_items/schema.json")
        );
        assert!(
            !root_files
                .iter()
                .any(|(path, _)| path == "contracts/schemas/queries.schema.json")
        );

        let include_manifest = manifest_with_backend(Some(ManifestBackend {
            root: None,
            include: Some(vec!["contracts/resources/**/queries.json".to_string()]),
        }));
        let include_files =
            collect_backend_files_for_manifest(dir.path(), &include_manifest).unwrap();
        assert_eq!(include_files.len(), 1);
        assert_eq!(
            include_files[0].0,
            "contracts/resources/work_items/queries.json"
        );
    }

    #[test]
    fn rejects_missing_explicit_backend_root() {
        let dir = tempdir().unwrap();
        let manifest = manifest_with_backend(Some(ManifestBackend {
            root: Some("missing-backend".to_string()),
            include: None,
        }));

        let error = collect_backend_files_for_manifest(dir.path(), &manifest).unwrap_err();
        assert!(error.contains("backend root does not exist"));
    }

    #[test]
    fn rejects_backend_root_outside_the_project() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir_all(outside.path().join("resources/items")).unwrap();
        fs::write(
            outside.path().join("resources/items/queries.json"),
            r#"{"$schema":"https://localapp.dev/schemas/backend/queries.schema.json","queries":{}}"#,
        )
        .unwrap();
        let manifest = manifest_with_backend(Some(ManifestBackend {
            root: Some(outside.path().to_string_lossy().into_owned()),
            include: None,
        }));

        let error = collect_backend_files_for_manifest(dir.path(), &manifest).unwrap_err();

        assert!(error.contains("backend root"));
        assert!(error.contains("project"));
    }

    #[test]
    fn rejects_backend_include_pattern_outside_the_project() {
        let dir = tempdir().unwrap();
        let manifest = manifest_with_backend(Some(ManifestBackend {
            root: None,
            include: Some(vec!["../outside/**/queries.json".to_string()]),
        }));

        let error = collect_backend_files_for_manifest(dir.path(), &manifest).unwrap_err();

        assert!(error.contains("backend.include"));
        assert!(error.contains("inside the project"));
    }

    #[test]
    fn rejects_unmatched_backend_include_pattern() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("contracts/resources/items")).unwrap();
        fs::write(
            dir.path().join("contracts/resources/items/queries.json"),
            r#"{"$schema":"https://localapp.dev/schemas/backend/queries.schema.json","queries":{}}"#,
        )
        .unwrap();
        let manifest = manifest_with_backend(Some(ManifestBackend {
            root: None,
            include: Some(vec!["contracts/resources/**/mutations.json".to_string()]),
        }));

        let error = collect_backend_files_for_manifest(dir.path(), &manifest).unwrap_err();

        assert!(error.contains("did not match any backend contract files"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_while_collecting_backend_contracts() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("contracts/resources/items")).unwrap();
        fs::write(
            outside.path().join("queries.json"),
            r#"{"$schema":"https://localapp.dev/schemas/backend/queries.schema.json","queries":{}}"#,
        )
        .unwrap();
        symlink(
            outside.path().join("queries.json"),
            dir.path().join("contracts/resources/items/queries.json"),
        )
        .unwrap();
        let manifest = manifest_with_backend(Some(ManifestBackend {
            root: Some("contracts".to_string()),
            include: None,
        }));

        let error = collect_backend_files_for_manifest(dir.path(), &manifest).unwrap_err();

        assert!(error.contains("symlink"));
    }

    #[test]
    fn rejects_backend_contract_without_schema_or_with_writing_query() {
        let missing_schema = vec![(
            "backend/resources/items/schema.json".to_string(),
            br#"{"name":"items"}"#.to_vec(),
        )];
        assert!(
            validate_backend_contract_files(&missing_schema)
                .unwrap_err()
                .contains("$schema")
        );

        let writing_query = vec![(
            "backend/resources/items/queries.json".to_string(),
            br#"{
          "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
          "queries": {
            "items.bad": { "kind": "query", "sql": "DELETE FROM items", "params": {} }
          }
        }"#
            .to_vec(),
        )];
        assert!(
            validate_backend_contract_files(&writing_query)
                .unwrap_err()
                .contains("read-only")
        );
    }

    #[test]
    fn rejects_duplicate_resource_schema_and_param_mismatch() {
        let duplicate = vec![
            (
                "backend/resources/a/schema.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
              "name": "items",
              "fields": {}
            }"#
                .to_vec(),
            ),
            (
                "backend/resources/b/schema.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
              "name": "items",
              "fields": {}
            }"#
                .to_vec(),
            ),
        ];
        assert!(
            validate_backend_contract_files(&duplicate)
                .unwrap_err()
                .contains("Duplicate")
        );

        let mismatch = vec![(
            "backend/resources/items/queries.json".to_string(),
            br#"{
          "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
          "queries": {
            "items.bad": {
              "kind": "query",
              "sql": "SELECT * FROM items WHERE status = :status AND owner_id = :currentUserId",
              "params": {
                "unused": { "type": "string" }
              }
            }
          }
        }"#
            .to_vec(),
        )];
        let error = validate_backend_contract_files(&mismatch).unwrap_err();
        assert!(error.contains("status"));
        assert!(error.contains("unused"));
    }

    #[test]
    fn rejects_named_sql_unknown_resource_or_field() {
        let unknown = vec![
            (
                "backend/resources/items/schema.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
              "name": "items",
              "fields": { "title": { "type": "string" } }
            }"#
                .to_vec(),
            ),
            (
                "backend/resources/items/queries.json".to_string(),
                br#"{
              "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
              "queries": {
                "items.bad": { "kind": "query", "sql": "SELECT ghost FROM items", "params": {} }
              }
            }"#
                .to_vec(),
            ),
        ];
        assert!(
            validate_backend_contract_files(&unknown)
                .unwrap_err()
                .contains("unknown field")
        );
    }

    #[test]
    fn allows_insert_select_fields_from_target_and_source_resources() {
        let files = vec![
            (
                "backend/resources/ai_subscriptions/schema.json".to_string(),
                br#"{
                  "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
                  "name": "ai_subscriptions",
                  "fields": {
                    "id": { "type": "auto_increment" },
                    "user_id": { "type": "string" }
                  }
                }"#
                .to_vec(),
            ),
            (
                "backend/resources/subscription_attachments/schema.json".to_string(),
                br#"{
                  "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
                  "name": "subscription_attachments",
                  "fields": {
                    "id": { "type": "auto_increment" },
                    "subscription_id": { "type": "integer" },
                    "user_id": { "type": "string" },
                    "file_name": { "type": "string" }
                  }
                }"#
                .to_vec(),
            ),
            (
                "backend/resources/subscription_attachments/mutations.json".to_string(),
                br#"{
                  "$schema": "https://localapp.dev/schemas/backend/mutations.schema.json",
                  "mutations": {
                    "subscription_attachments.create": {
                      "kind": "mutation",
                      "sql": "INSERT INTO subscription_attachments (subscription_id, user_id, file_name) SELECT s.id, s.user_id, :fileName FROM ai_subscriptions s WHERE s.id = :subscriptionId AND (:currentUserId = :ownerId OR s.user_id = :currentUserId)",
                      "params": {
                        "subscriptionId": { "type": "number", "required": true },
                        "fileName": { "type": "string", "required": true }
                      }
                    }
                  }
                }"#
                .to_vec(),
            ),
        ];

        validate_backend_contract_files(&files).unwrap();
    }

    #[test]
    fn allows_update_table_names_containing_set_without_fake_fields() {
        let files = vec![
            ("backend/resources/category_stage_settings/schema.json".to_string(), br#"{
              "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
              "name": "category_stage_settings",
              "fields": {
                "id": { "type": "auto_increment" },
                "level1_category_id": { "type": "integer" },
                "stage_template_id": { "type": "integer" },
                "enabled": { "type": "boolean" },
                "sort_order": { "type": "integer" },
                "updated_at": { "type": "datetime" }
              }
            }"#.to_vec()),
            ("backend/resources/category_stage_settings/mutations.json".to_string(), br#"{
              "$schema": "https://localapp.dev/schemas/backend/mutations.schema.json",
              "mutations": {
                "categoryStageSettings.update": {
                  "kind": "mutation",
                  "sql": "UPDATE category_stage_settings SET enabled = :enabled, sort_order = :sort_order, updated_at = :now WHERE id = :id",
                  "params": {
                    "id": { "type": "number" },
                    "enabled": { "type": "boolean" },
                    "sort_order": { "type": "number" }
                  }
                }
              }
            }"#.to_vec()),
        ];
        validate_backend_contract_files(&files).unwrap();
    }

    #[test]
    fn allows_cte_names_when_validating_named_sql_references() {
        let files = vec![
            ("backend/resources/items/schema.json".to_string(), br#"{
              "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
              "name": "items",
              "fields": { "id": { "type": "auto_increment" }, "title": { "type": "string" } }
            }"#.to_vec()),
            ("backend/resources/items/queries.json".to_string(), br#"{
              "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
              "queries": {
                "items.latest": {
                  "kind": "query",
                  "sql": "WITH latest AS (SELECT id, title FROM items) SELECT * FROM latest ORDER BY id",
                  "params": {}
                }
              }
            }"#.to_vec()),
        ];
        validate_backend_contract_files(&files).unwrap();
    }

    #[test]
    fn allows_named_sql_to_join_tables_not_declared_as_resource_schemas_when_fields_are_metadata_only()
     {
        let files = vec![
            ("backend/resources/items/schema.json".to_string(), br#"{
              "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
              "name": "items",
              "business": { "ownerField": "created_by_member_id" }
            }"#.to_vec()),
            ("backend/resources/items/queries.json".to_string(), br#"{
              "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
              "queries": {
                "items.mine": {
                  "kind": "query",
                  "sql": "SELECT items.* FROM items JOIN members ON members.id = items.created_by_member_id WHERE members.user_id = :currentUserId",
                  "params": {}
                }
              }
            }"#.to_vec()),
        ];
        validate_backend_contract_files(&files).unwrap();
    }
}
