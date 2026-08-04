use std::fs;
use std::io::Write;

pub fn run_schema(name: &str) -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    let dir = cwd.join("backend").join("resources").join(name);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create backend resource dir: {e}"))?;

    let schema_template = serde_json::json!({
        "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
        "name": name,
        "fields": {
            "title": { "type": "string", "constraints": { "required": true } },
            "status": { "type": "string" },
            "priority": { "type": "number" }
        }
    });
    let queries_template = serde_json::json!({
        "$schema": "https://localapp.dev/schemas/backend/queries.schema.json",
        "queries": {
            format!("${name}.list"): {
                "kind": "query",
                "sql": format!("SELECT * FROM {name} ORDER BY id DESC LIMIT :limit OFFSET :offset"),
                "params": {
                    "limit": { "type": "number", "required": true },
                    "offset": { "type": "number", "required": true }
                },
                "result": { "mode": "page", "maxRows": 100, "maxBytes": 65536 },
                "access": "authenticated"
            }
        }
    });
    let mutations_template = serde_json::json!({
        "$schema": "https://localapp.dev/schemas/backend/mutations.schema.json",
        "mutations": {}
    });

    write_json(&dir.join("schema.json"), &schema_template)?;
    write_json(&dir.join("queries.json"), &queries_template)?;
    write_json(&dir.join("mutations.json"), &mutations_template)?;

    println!("Created backend resource: backend/resources/{name}/");
    println!(
        "  Edit schema.json, queries.json, and mutations.json; uploads validate these backend contract files automatically."
    );

    Ok(())
}

fn write_json(path: &std::path::Path, value: &serde_json::Value) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

pub fn run_page(name: &str) -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    let dir = cwd.join("src").join("pages");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create pages dir: {e}"))?;

    let pascal = to_pascal_case(name);
    let template = format!(
        r#""use client";

import {{ useList, useCreate }} from "@localapp/sdk-react";

interface Item {{
  id: number;
  title: string;
  created_at: string;
}}

export default function {pascal}() {{
  const {{ rows, loading, refresh }} = useList<Item>("{name}");
  const {{ create }} = useCreate<Item>("{name}");

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1>{pascal}</h1>
      {{rows.length === 0 ? (
        <p>No items yet.</p>
      ) : (
        <ul>
          {{rows.map((item) => (
            <li key={{item.id}}>{{item.title}}</li>
          ))}}
        </ul>
      )}}
    </div>
  );
}}
"#
    );

    let path = dir.join(format!("{pascal}.tsx"));
    let mut file = fs::File::create(&path).map_err(|e| format!("Failed to create page: {e}"))?;
    file.write_all(template.as_bytes())
        .map_err(|e| format!("Failed to write page: {e}"))?;

    println!("Created page: src/pages/{pascal}.tsx");

    Ok(())
}

pub fn run_component(name: &str) -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    let dir = cwd.join("src").join("components");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create components dir: {e}"))?;

    let pascal = to_pascal_case(name);
    let template = format!(
        r#"interface {pascal}Props {{
  className?: string;
}}

export function {pascal}({{ className }}: {pascal}Props) {{
  return (
    <div className={{className}}>
      {pascal}
    </div>
  );
}}
"#
    );

    let path = dir.join(format!("{pascal}.tsx"));
    let mut file =
        fs::File::create(&path).map_err(|e| format!("Failed to create component: {e}"))?;
    file.write_all(template.as_bytes())
        .map_err(|e| format!("Failed to write component: {e}"))?;

    println!("Created component: src/components/{pascal}.tsx");

    Ok(())
}

fn to_pascal_case(s: &str) -> String {
    s.split(&['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first
                    .to_uppercase()
                    .chain(chars.flat_map(|c| c.to_lowercase()))
                    .collect(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::run_schema;
    use serde_json::Value;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn schema_generator_writes_backend_resource_contract() {
        let dir = tempdir().unwrap();
        let original = std::env::current_dir().unwrap();
        std::env::set_current_dir(dir.path()).unwrap();

        run_schema("work_items").unwrap();

        std::env::set_current_dir(original).unwrap();

        let resource_dir = dir.path().join("backend/resources/work_items");
        assert!(resource_dir.join("schema.json").exists());
        assert!(resource_dir.join("queries.json").exists());
        assert!(resource_dir.join("mutations.json").exists());
        assert!(!dir.path().join("schemas/work_items.json").exists());

        let schema: Value =
            serde_json::from_str(&fs::read_to_string(resource_dir.join("schema.json")).unwrap())
                .unwrap();
        let queries: Value =
            serde_json::from_str(&fs::read_to_string(resource_dir.join("queries.json")).unwrap())
                .unwrap();
        assert_eq!(
            schema["$schema"],
            "https://localapp.dev/schemas/backend/resource-schema.schema.json"
        );
        assert_eq!(schema["name"], "work_items");
        assert_eq!(
            queries["$schema"],
            "https://localapp.dev/schemas/backend/queries.schema.json"
        );
        assert!(queries["queries"]["$work_items.list"].is_object());
        assert_eq!(
            queries["queries"]["$work_items.list"]["result"]["mode"],
            "page"
        );
    }
}
