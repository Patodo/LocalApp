import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
it("keeps dsh session state outside the supplied project and denies terminal network access", async () => {
 const {DeepSeekHarness}=await import("../../deepseek-harness.mjs");
 const dir=path.resolve(__dirname,"../../../../../../tmp/platform-development/workspace-test");fs.rmSync(dir,{recursive:true,force:true});
 const workspace=path.join(dir,"project");fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,"source.txt"),"project-source");
 const harness=new DeepSeekHarness({llmApiKey:"",llmModel:"test",llmBaseUrl:"http://127.0.0.1:9",root:path.join(dir,"sessions"),workspaceRoot:workspace,dataRoot:dir,networkBlocked:true,capabilities:["files","terminal"]});
 try {await harness.initialize();
  const result=await harness.executeDevelopmentCommand(process.execPath,["-e","console.log(require('fs').readFileSync('source.txt','utf8'));try{require('fs').readFileSync('../sessions/private','utf8');process.exit(7)}catch{}"]);
  expect(result.exitCode).toBe(0);expect(result.stdout.text).toContain("project-source");
  const network=await harness.executeDevelopmentCommand(process.execPath,["-e","require('http').get('http://127.0.0.1:9',()=>process.exit(7)).on('error',e=>{console.log(e.code)})"]);
  expect(network.stdout.text).toMatch(/EPERM|EACCES|ENETUNREACH/);
  expect(fs.existsSync(path.join(workspace,"sessions"))).toBe(false);
 } finally {await harness.close();fs.rmSync(dir,{recursive:true,force:true});}
},30_000);
