import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { selectPythonEnvironment, readPythonEnvironment, shellQuote } from "../python-environment.js";
const root=path.resolve(__dirname,"../../../../../tmp/python-environment-unit",String(process.pid));
afterEach(async()=>{vi.restoreAllMocks();await fs.rm(root,{recursive:true,force:true});});
it("rejects relative executable paths without running a process or changing configuration",async()=>{
 await fs.mkdir(root,{recursive:true});
 await expect(selectPythonEnvironment(root,"python3")).rejects.toThrow("绝对路径");
 expect(readPythonEnvironment(root)).toBeUndefined();
});
it("quotes executable paths without shell substitution",()=>{
 expect(shellQuote("/a b/it's/python$(id)")).toBe("'/a b/it'\\''s/python$(id)'");
});
