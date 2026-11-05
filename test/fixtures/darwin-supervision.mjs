/** Controlled product supervision owner. No full Broker CLI qualification. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HostTenure } from '#oma-test/app/runtime/host-tenure';
import { claimSocietyFence } from '#oma-test/app/runtime/society-lease';
import { openSupervisionChannel } from '#oma-test/app/runtime/supervision-channel';
import { spawnSupervisedService, SOCIETY_FENCE_ENV } from '@oma/process/async';
import { HostChannelReader, encodeHostMessage } from '@oma/protocol/host-channel';

const [state, mode] = process.argv.slice(2);
if (!state || !['host', 'broker'].includes(mode)) throw new Error('invalid supervision fixture');
if (mode === 'broker') {
  // Bounds failed-fixture lifetime, without supplying the expected exit.
  setTimeout(() => process.exit(9), 15000).unref();
  if (claimSocietyFence(state).kind !== 'inherited') throw new Error('Broker has no inherited Society');
  const channel = openSupervisionChannel({ fd: 3, log: line => console.error(line), onHostGone(reason) {
    writeFileSync(join(state, 'broker-ended.json'), JSON.stringify({ reason, pid: process.pid }));
    process.exit(0);
  } });
  if (!channel || channel.host.pid !== process.ppid) throw new Error('private original Host was not bound');
  channel.onSession((handle, pid) => {
    if (pid !== channel.host.pid) throw new Error('fixture session changed');
    channel.grant('a'.repeat(64), handle);
  });
  channel.ready();
} else {
  const tenure = HostTenure.take(state);
  if (!tenure) throw new Error('Host tenure was not acquired');
  const child = spawnSupervisedService(process.execPath, [import.meta.filename, state, 'broker'],
    { ...process.env, [SOCIETY_FENCE_ENV]: '4' }, true, tenure.fence);
  child.on('error', error => { throw error; });
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  const channel = child.stdio[3], handle = 'b'.repeat(32);
  const reader = new HostChannelReader(message => {
    if (message.kind === 'ready') channel.write(encodeHostMessage({ kind: 'session', sessionHandle: handle, pid: process.pid }));
    else if (message.kind === 'credential' && message.sessionHandle === handle && message.credential === 'a'.repeat(64))
      process.send({ kind: 'ready', host: process.pid, broker: child.pid });
    else throw new Error('unexpected private supervision reply');
  }, reason => { throw new Error(reason); });
  channel.on('data', bytes => reader.push(bytes));
  channel.on('error', () => {});
  process.on('message', async message => {
    if (message !== 'stop') throw new Error('unknown fixture control');
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('close', resolve));
    await tenure.end();
    process.disconnect();
  });
}
