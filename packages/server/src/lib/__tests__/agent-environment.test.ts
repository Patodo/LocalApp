import { expect, it } from "vitest";
import { summarizeEnvironment } from "../agent-environment.js";
it("uses one supported interpreter for all selected skill dependencies and ignores optional renderers",()=>{
 const output=[{version:[3,9,6],python:"old",modules:{pypdf:true,pdfplumber:true,reportlab:true},commands:{}},{version:[3,12,0],python:"new",modules:{pypdf:true,pdfplumber:true,reportlab:true},commands:{}}].map(p=>JSON.stringify(p)).join("\n");
 const report=summarizeEnvironment(output,["pdf"],[]);
 expect(report.ready).toBe(true);expect(report.checks.find(c=>c.id==="python")?.detail).toContain("new");expect(report.checks.find(c=>c.id==="pdf-render")?.status).toBe("missing");
});
it("does not combine modules from separate interpreters or treat old Python as ready",()=>{
 const output=JSON.stringify({version:[3,9,6],python:"old",modules:{pypdf:true},commands:{}});
 const report=summarizeEnvironment(output,["pdf"],[]);
 expect(report.ready).toBe(false);expect(report.checks.find(c=>c.id==="pdfplumber")?.status).toBe("missing");expect(report.checks.find(c=>c.id==="python")?.status).toBe("missing");
});
it("reports disabled terminal even without selected skills",()=>{
 expect(summarizeEnvironment("diagnostics",[],[{id:"terminal",name:"终端",status:"blocked",detail:"关闭",required:true}]).ready).toBe(false);
});
it("checks only dependencies for selected skills",()=>{
 const report=summarizeEnvironment(JSON.stringify({version:[3,12,0],python:"python",modules:{docx:true},commands:{soffice:true}}),["docx"],[]);
 expect(report.ready).toBe(true);expect(report.checks.some(c=>c.id==="pdfplumber")).toBe(false);expect(report.checks.find(c=>c.id==="office")?.status).toBe("ready");
});
