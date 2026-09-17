// CLI entrypoint: command routing and top-level process failure only.
import { runAckCommand, runSendCommand } from "./cli/commands/send.js";
import { runRouteCommand } from "./cli/commands/routes.js";
import { runAgentCommand } from "./cli/commands/agent.js";
import { runSubmitCommand } from "./cli/commands/submit.js";
import { runIntegrateCommand } from "./cli/commands/integrate.js";
import { runContextCommand } from "./cli/commands/context.js";
import { runStatusCommand } from "./cli/commands/status.js";
import { runLogsCommand } from "./cli/commands/logs.js";
import { fatal, usage } from "./cli/exit.js";

export async function main(argv: string[]): Promise<never> {
  const [command, ...rest] = argv;
  switch (command) {
    case "send":
      return runSendCommand(rest);
    case "ack":
      return runAckCommand(rest);
    case "follow":
      return runRouteCommand(rest, true);
    case "unfollow":
      return runRouteCommand(rest, false);
    case "agent":
      return runAgentCommand(rest);
    case "submit":
      return runSubmitCommand(rest);
    case "integrate":
      return runIntegrateCommand(rest);
    case "context":
      if (rest[0] === "publish") return runContextCommand(rest.slice(1));
      return usage();
    case "status":
      return runStatusCommand(rest);
    case "logs":
      return runLogsCommand(rest);
    default:
      return usage();
  }
}

main(process.argv.slice(2)).catch(fatal);
