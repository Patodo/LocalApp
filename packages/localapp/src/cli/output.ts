export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export function defaultCliIo(): CliIo {
  return {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
}

export function writeStructuredError(io: CliIo, error: Record<string, unknown>): void {
  io.stderr(`${JSON.stringify({ error })}\n`);
}
