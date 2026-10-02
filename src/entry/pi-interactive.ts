import { runInteractive } from "./pi-interactive-host.js";

// A start that failed is a failure: the engine's own SIGTERM handling would
// turn a self-signal into a clean exit, which the host would read as a quit.
void runInteractive().catch(error => {
  process.stderr.write(`OMA interactive startup failed: ${String(error)}\n`);
  process.exit(1);
});
