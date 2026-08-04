import fs from "node:fs";
import path from "node:path";

export type FixtureApp = {
  id: string;
  version: string;
  versionRoot: string;
  dataRoot: string;
};

export function createFixtureApp(
  root: string,
  id: string,
  options: { invalidMigration?: boolean } = {},
): FixtureApp {
  const versionRoot = path.join(root, "apps", id, "versions", "1.0.0");
  const dataRoot = path.join(root, "app-data", id);
  fs.mkdirSync(path.join(versionRoot, "dist", "assets"), { recursive: true });
  fs.mkdirSync(path.join(versionRoot, "migrations"), { recursive: true });
  fs.mkdirSync(path.join(versionRoot, "backend", "resources", "items"), {
    recursive: true,
  });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(
    path.join(versionRoot, "manifest.json"),
    JSON.stringify({ name: id, platformVersion: "^1.0" }),
  );
  fs.writeFileSync(
    path.join(versionRoot, "dist", "index.html"),
    '<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>',
  );
  fs.writeFileSync(
    path.join(versionRoot, "dist", "assets", "app.js"),
    `document.getElementById("root").textContent = ${JSON.stringify(id)};`,
  );
  fs.writeFileSync(
    path.join(versionRoot, "dist", "assets", "app.css"),
    "body { color: rgb(12, 34, 56); }",
  );
  fs.writeFileSync(
    path.join(versionRoot, "migrations", "001_items.sql"),
    options.invalidMigration
      ? "CREATE TABL broken("
      : "CREATE TABLE items(id TEXT PRIMARY KEY, title TEXT NOT NULL);",
  );
  fs.writeFileSync(
    path.join(versionRoot, "backend", "resources", "items", "schema.json"),
    JSON.stringify({
      $schema:
        "https://localapp.dev/schemas/backend/resource-schema.schema.json",
      name: "items",
      fields: {
        id: { type: "text" },
        title: { type: "text", constraints: { required: true } },
      },
    }),
  );
  fs.writeFileSync(
    path.join(versionRoot, "backend", "resources", "items", "queries.json"),
    JSON.stringify({
      $schema: "https://localapp.dev/schemas/backend/queries.schema.json",
      queries: {
        "items.list": {
          sql: "SELECT id, title FROM items ORDER BY id",
          params: {},
          access: "authenticated",
          result: { mode: "bounded", maxRows: 100, maxBytes: 65536 },
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(versionRoot, "backend", "resources", "items", "mutations.json"),
    JSON.stringify({
      $schema: "https://localapp.dev/schemas/backend/mutations.schema.json",
      mutations: {
        "items.create": {
          sql: "INSERT INTO items(id, title) VALUES (:id, :title)",
          params: {
            id: { type: "string", required: true },
            title: { type: "string", required: true },
          },
          access: "authenticated",
        },
      },
    }),
  );
  return { id, version: "1.0.0", versionRoot, dataRoot };
}
