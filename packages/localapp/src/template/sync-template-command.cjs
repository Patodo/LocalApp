function buildSyncInvocation(executable, platform = process.platform, commandInterpreter = process.env.ComSpec || "cmd.exe") {
  if (platform === "win32" && /\.(?:bat|cmd)$/i.test(executable)) {
    if (/["%\r\n\0]/.test(executable)) {
      throw new Error("LocalApp executable has an unsafe Windows command path");
    }
    return {
      command: commandInterpreter,
      args: ["/d", "/s", "/v:off", "/c", `""${executable}" sync-template --quiet"`],
      spawnOptions: { shell: false, windowsHide: true, windowsVerbatimArguments: true },
    };
  }
  return {
    command: executable,
    args: ["sync-template", "--quiet"],
    spawnOptions: { shell: false, windowsHide: true },
  };
}

module.exports = { buildSyncInvocation };
