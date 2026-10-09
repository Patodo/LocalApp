import path from "node:path";
import { readPythonEnvironment } from "./python-environment.js";
import { PUBLIC_SKILL_PYTHON_MODULES, type AgentEnvironment } from "./agent-environment.js";
import { PUBLIC_AGENT_SKILLS } from "./public-agent-skills.js";
const checks = new Map<string, {at:number;pending:boolean;report:Promise<AgentEnvironment>}>();
export async function systemAgentEnvironment(dataDir: string): Promise<AgentEnvironment> {
 const pythonEnvironment=readPythonEnvironment(dataDir);
 const key=dataDir+":"+(pythonEnvironment?.revision ?? "default");
 const previous=checks.get(key);
 if(previous && (previous.pending || Date.now()-previous.at < 15_000))return previous.report;
 const report=(async()=>{
  const { DeepSeekHarness }=await import("./deepseek-harness.mjs");
  const harness=new DeepSeekHarness({llmApiKey:"environment-check",llmBaseUrl:"http://127.0.0.1:9",llmModel:"environment-check",root:path.join(dataDir,"agent","system-environment"),capabilities:["files","terminal","skills"],skills:PUBLIC_AGENT_SKILLS.map(s=>s.id),pythonEnvironment});
  try{
   await harness.initialize();
   const report=await harness.checkEnvironment();
   return { ...report, checks: report.checks.filter(check => check.id !== "terminal").map(check => check.id === "runner" ? { ...check, name: "系统命令执行", detail: check.status === "ready" ? "LocalApp 执行器可运行文档处理命令。" : "LocalApp 执行器不可用，请检查 Server 执行支持。" } : check) };
  }finally{await harness.close();}
 })();
 checks.set(key,{at:Date.now(),pending:true,report});
 try{const result=await report;checks.set(key,{at:Date.now(),pending:false,report});return result;}catch(error){checks.delete(key);throw error;}
}

export function publicSkillAvailability(report:AgentEnvironment) {
 const ready=(id:string)=>report.checks.some(c=>c.id===id && c.status==="ready");
 return PUBLIC_AGENT_SKILLS.map(skill=>({...skill,available:["runner","python",...PUBLIC_SKILL_PYTHON_MODULES[skill.id]].every(ready),unavailableReason:"系统文档处理环境尚未就绪，请联系管理员检查依赖。"}));
}
