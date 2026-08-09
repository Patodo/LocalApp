import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const [, , token, acknowledgementPath, executable, encodedArgs] = process.argv;
if (!token || !acknowledgementPath || !executable || !encodedArgs) {
  console.error("Invalid LocalApp task supervisor invocation");
  process.exit(125);
}

let args;
try {
  args = JSON.parse(Buffer.from(encodedArgs, "base64url").toString("utf8"));
  if (!Array.isArray(args) || !args.every((argument) => typeof argument === "string")) throw new Error("invalid args");
} catch {
  console.error("Invalid LocalApp task supervisor arguments");
  process.exit(125);
}

// The unique token intentionally remains in this supervisor's argv. Server
// startup reconciliation verifies the complete process identity before kill.
void token;
const child = spawn(executable, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: "inherit",
  windowsHide: true,
});

let exiting = false;
async function exitAfterIdentityAcknowledgement(code) {
  if (exiting) return;
  exiting = true;
  const deadline = Date.now() + 2_000;
  while (!existsSync(acknowledgementPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  process.exit(code);
}

child.once("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  void exitAfterIdentityAcknowledgement(127);
});
child.once("close", (code, signal) => {
  const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
  void exitAfterIdentityAcknowledgement(exitCode);
});
