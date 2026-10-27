/** Physical crash checkpoints delegate every production journal operation.
 * SIGSTOP keeps the exact boundary stable until the parent sends SIGKILL. */
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { ExecutionJournal } from '@oma/storage/execution-journal';
import { ExecutionCoordinator } from '@oma/process/owned-execution';
import { launchBlockedNamespace } from '@oma/platform-linux/namespace-execution';
import { runnerScope } from '@oma/platform-linux/runner-scope';
import { observeNamespaceProcess } from '@oma/native/pid-namespace';
const [root, phase] = process.argv.slice(2);
let witness = null;
function checkpoint(at) {
  if (at !== phase) return;
  writeFileSync(join(root, 'checkpoint.json'), JSON.stringify({ phase: at, witness }));
  process.kill(process.pid, 'SIGSTOP');
}
ExecutionJournal.initialize(root);
checkpoint('after-initialize');
const journal = ExecutionJournal.open(root);
const reserve = journal.reserve.bind(journal);
journal.reserve = slot => {
  const reservation = reserve(slot); checkpoint('after-opening');
  return Object.freeze({ execution: reservation.execution,
    publish(value) { reservation.publish(value); witness = value; checkpoint('after-witness'); },
    retire() { checkpoint('before-closed'); reservation.retire(); checkpoint('after-closed'); },
  });
};
const owner = new ExecutionCoordinator(journal, identity => observeNamespaceProcess(identity.pid));
const effect = join(root, 'effect');
const program = `require('node:fs').writeFileSync(${JSON.stringify(effect)}, 'once'); ${phase === 'after-effect' ? 'setInterval(() => {}, 1000)' : ''}`;
const command = runnerScope({ executable: process.execPath, argv: ['-e', program], env: { PATH: '/usr/bin:/bin', HOME: root },
  timeoutMs: null, stdoutBytes: 65536, stderrBytes: 65536 });
const ticket = await owner.begin({ slot: 'resident:alpha', launch: () => launchBlockedNamespace(command), authorize() {} });
if (phase === 'after-effect') {
  while (!existsSync(effect)) await setTimeout(5);
  checkpoint('after-effect');
}
await ticket.completion;
await owner.drain(); journal.close();
throw new Error('crash fixture did not stop at its selected physical boundary');
