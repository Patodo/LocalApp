import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
it("keeps dsh session state outside the supplied project and denies terminal network access", async () => {
  const { DeepSeekHarness } = await import("../../deepseek-harness.mjs");
  const dir = path.resolve(
    __dirname,
    "../../../../../../tmp/platform-development/workspace-test",
  );
  fs.rmSync(dir, { recursive: true, force: true });
  const workspace = path.join(dir, "project");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "source.txt"), "project-source");
  fs.mkdirSync(path.join(dir, "sessions"));
  fs.writeFileSync(path.join(dir, "sessions", "private"), "must-not-read");
  const harness = new DeepSeekHarness({
    llmApiKey: "",
    llmModel: "test",
    llmBaseUrl: "http://127.0.0.1:9",
    root: path.join(dir, "sessions"),
    workspaceRoot: workspace,
    dataRoot: dir,
    networkBlocked: true,
    capabilities: ["files", "terminal"],
  });
  let requests = 0;
  const endpoint = http.createServer((_req, res) => {
    requests++;
    res.end("reachable");
  });
  try {
    await new Promise<void>((resolve, reject) => {
      endpoint.once("error", reject);
      endpoint.listen(0, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}`;
    expect(await (await fetch(url)).text()).toBe("reachable");
    const baselineRequests = requests;
    await harness.initialize();
    const result = await harness.executeDevelopmentCommand(process.execPath, [
      "-e",
      "console.log(require('fs').readFileSync('source.txt','utf8'));try{require('fs').readFileSync('../sessions/private','utf8');process.exit(7)}catch{}",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.text).toContain("project-source");
    const network = await harness.executeDevelopmentCommand(process.execPath, [
      "-e",
      `require('http').get(${JSON.stringify(url)},()=>process.exit(7)).on('error',e=>{console.log(e.code)})`,
    ]);
    // Seatbelt refuses the operation; bwrap gives the process its own loopback.
    expect(network.exitCode).toBe(0);
    expect(network.stdout.text).toMatch(/EPERM|EACCES|ENETUNREACH|ECONNREFUSED/);
    expect(requests).toBe(baselineRequests);
    expect(fs.existsSync(path.join(workspace, "sessions"))).toBe(false);
  } finally {
    endpoint.closeAllConnections();
    await new Promise<void>((resolve) => endpoint.close(() => resolve()));
    await harness.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
