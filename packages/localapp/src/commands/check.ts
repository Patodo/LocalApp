import type { CliIo } from "../cli/output.js";
import { checkProject } from "../project/check.js";

export async function check(io: CliIo, json: boolean): Promise<number> {
  const report = await checkProject({ projectDir: process.cwd() });
  if (json) {
    io.stdout(`${JSON.stringify(report)}\n`);
  } else {
    io.stdout(`${JSON.stringify({
      success: report.success,
      failedPhase: report.failedPhase,
      phases: report.phases,
      diagnostics: report.diagnostics,
    })}\n`);
  }
  return report.success ? 0 : 1;
}
