import type { CliIo } from "../cli/output.js";
import { buildApplicationPackage } from "../project/package.js";

export async function buildPackage(output: string | undefined, io: CliIo): Promise<number> {
  const result = await buildApplicationPackage({ projectDir: process.cwd(), outputPath: output });
  io.stdout(`${JSON.stringify({ success: true, ...result })}\n`);
  return 0;
}
