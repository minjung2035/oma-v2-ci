// Real pre-session UI only: no model, credentials, broker or user settings.
import { chooseSessionMode } from '../../dist/src/tui/session-mode.js';
const mode = await chooseSessionMode({ input: process.stdin, output: process.stdout });
process.stdout.write(`MODE_RESULT=${mode ?? 'cancel'}\n`);
