// Real pre-session UI only: no model, credentials, broker or user settings.
import { chooseSessionMode } from '@oma/tui/session-mode';
const mode = await chooseSessionMode({ input: process.stdin, output: process.stdout });
process.stdout.write(`MODE_RESULT=${mode ?? 'cancel'}\n`);
