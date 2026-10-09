import fs from "node:fs";
import path from "node:path";
import {beforeEach,afterEach,it,expect} from "vitest";
import {initMetaDb,closeMetaDb} from "../../meta-sqlite.js";
import {ProjectStore} from "../../development/projects.js";
import {DevelopmentBuilds} from "../../development/builds.js";
const dir=path.resolve(__dirname,"../../../../../../tmp/platform-development/build-tests");let projects:ProjectStore;
beforeEach(async()=>{closeMetaDb();fs.rmSync(dir,{recursive:true,force:true});await initMetaDb(dir);projects=new ProjectStore(dir);});
afterEach(()=>{closeMetaDb();fs.rmSync(dir,{recursive:true,force:true});});
it("builds a fixed version and reconciles interrupted records",async()=>{
 const p=projects.create("alice","example-app",{"src/main.ts":"first"});let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);
 const builds=new DevelopmentBuilds(dir,projects,async input=>{await gate;expect(fs.readFileSync(path.join(input.workspace,"src/main.ts"),"utf8")).toBe("first");return {path:path.join(input.workspace,"app.localapp"),sha256:"test"};});
 const b=builds.start(p.id,"alice");const f=projects.read(p.id,"alice","src/main.ts");projects.write(p.id,"alice",f.path,"second",f.hash);finish();await builds.wait(b.id);
 expect(builds.get(p.id,"alice",b.id).status).toBe("succeeded");expect(()=>builds.get(p.id,"bob",b.id)).toThrow();
 const file=path.join(projects.directory,p.id,"builds",b.id,"record.json");const record=JSON.parse(fs.readFileSync(file,"utf8"));record.status="running";fs.writeFileSync(file,JSON.stringify(record));
 const restarted=new DevelopmentBuilds(dir,projects,async()=>{throw Error("never")});expect(restarted.get(p.id,"alice",b.id).status).toBe("interrupted");
});
it("does not mark failed or cancelled builds publishable",async()=>{
 const p=projects.create("alice","example-app",{"src/a":"a"});const builds=new DevelopmentBuilds(dir,projects,async()=>{throw Error("build failed")});const b=builds.start(p.id,"alice");await builds.wait(b.id);expect(builds.get(p.id,"alice",b.id).status).toBe("failed");expect(builds.get(p.id,"alice",b.id).log).toContain("build failed");
});
