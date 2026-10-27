// CLI entrypoint: command routing and top-level process failure only.
import { runSocietyCommand } from "./cli/commands/society.js";
import { runAckCommand, runSendCommand } from "./cli/commands/send.js";
import { runRouteCommand } from "./cli/commands/routes.js";
import { runAgentCommand } from "./cli/commands/agent.js";
import { runSubmitCommand } from "./cli/commands/submit.js";
import { runMergeCommand, runChallengeCommand } from "./cli/commands/merge.js";
import { runContextCommand } from "./cli/commands/context.js";
import { runStatusCommand } from "./cli/commands/status.js";
import { runLogsCommand } from "./cli/commands/logs.js";
import { splitSubcommand } from "./cli/arguments.js";
import { fatal, holdOutputUntilWritten, usage } from "./cli/exit.js";

export async function main(argv: string[]): Promise<never> {
  const [command, ...rest] = argv;
  switch (command) {
    case "society": return runSocietyCommand(rest);
    case "merge": return runMergeCommand(rest);
    case "challenge": return runChallengeCommand(rest);
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
    case "context": {
      const sub = splitSubcommand(rest, { "--expect": "value", "--request": "value" });
      if (sub.name === "publish") return runContextCommand(sub.rest);
      return usage();
    }
    case "status":
      return runStatusCommand(rest);
    case "logs":
      return runLogsCommand(rest);
    default:
      return usage();
  }
}

holdOutputUntilWritten();
main(process.argv.slice(2)).catch(fatal);
