/** Controlled Host -> own Broker child Mach RPC owner. No full Broker CLI qualification. */
import { appendFileSync } from 'node:fs';
import { spawnSupervisedService } from '@oma/process/async';
import { socketDescriptor } from '@oma/native/linux';
import { pinDarwinPrivateChild } from '@oma/native/private-parent';
import { createMachBrokerTransport, dialOwnedChildMachChannel } from '@oma/platform-mac/mach-transport';

const [path, mode, stages] = process.argv.slice(2);
if (!path || !['host', 'broker'].includes(mode) || !stages) throw new Error('invalid owned Broker RPC fixture');
// Survives a kill: the last stage names where an actual Darwin run stopped.
const stage = name => appendFileSync(stages, `${mode} ${process.pid} ${name}\n`);
if (mode === 'broker') {
  // Bounds failed-fixture lifetime, without supplying the expected exit.
  setTimeout(() => process.exit(9), 15000).unref();
  const transport = createMachBrokerTransport(5), { Socket } = await import('node:net');
  const channel = new Socket({ fd: 3, readable: true, writable: true });
  channel.on('error', () => {});
  stage('listener');
  const { listener } = transport.openListener(socket => {
    stage('accepted');
    const pin = transport.pinPeer(socket);
    if (pin === null) { socket.destroy(); return; }
    // Same sender rule the Broker applies to every pinned connection.
    const stream = transport.peerStream(socket, sender => pin.sameSender(sender) && pin.alive());
    stream.on('error', () => {});
    stream.once('data', bytes => stream.end(JSON.stringify({ request: String(bytes), peer: pin.pid, broker: process.pid })));
    stream.once('close', () => pin.close());
  });
  listener.on('error', error => { channel.end(`error:${error.message}\n`); });
  listener.on('listening', () => { stage('listening'); channel.write('ready\n'); });
  listener.listen(path);
  channel.once('end', () => process.exit(0));
} else {
  setTimeout(() => { fail(new Error('owned Broker RPC fixture deadline')); child.kill('SIGKILL'); setTimeout(() => process.exit(1), 100); }, 25000).unref();
  const child = spawnSupervisedService(process.execPath, [import.meta.filename, path, 'broker', stages], { ...process.env }, true);
  stage(`broker-pid ${child.pid}`);
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  const channel = child.stdio[3];
  channel.on('error', () => {});
  const fail = error => { process.send({ kind: 'failed', message: String(error?.stack ?? error) }); };
  const code = error => { try { error(); return 'accepted'; } catch (failure) { return failure?.code ?? String(failure?.message); } };
  channel.once('data', async bytes => {
    try {
      if (String(bytes) !== 'ready\n') throw new Error(`Broker child was not ready: ${bytes}`);
      stage('broker-ready');
      const fd = socketDescriptor(channel);
      // The relationship is the kernel parent of this exact socket peer, not a supplied number.
      const notChild = pinDarwinPrivateChild(fd, process.ppid);
      const pin = pinDarwinPrivateChild(fd, child.pid);
      if (pin === null) throw new Error('own Broker child identity was not acquired');
      stage('pinned');
      const dial = dialOwnedChildMachChannel(path, 5, pin);
      dial.socket.on('error', () => {});
      await dial.ready;
      stage('dialed');
      const reply = new Promise((resolve, reject) => {
        let text = '';
        dial.socket.on('data', part => { text += part; try { resolve(JSON.parse(text)); } catch { /* incomplete reply */ } });
        dial.socket.once('error', reject);
      });
      dial.socket.write('ping');
      const answer = await reply;
      stage('answered');
      dial.socket.destroy();
      pin.close();
      const afterReturn = code(() => dialOwnedChildMachChannel(path, 5, pin));
      channel.end();
      await new Promise(resolve => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve));
      process.send({ kind: 'result', host: process.pid, broker: child.pid, notChild: notChild === null, answer, afterReturn,
        brokerExit: { code: child.exitCode, signal: child.signalCode } });
    } catch (error) { child.kill('SIGKILL'); fail(error); }
  });
  child.once('exit', (code, signal) => { if (code !== 0) fail(new Error(`Broker child ended ${code ?? signal}`)); });
  process.once('message', () => process.disconnect());
}
