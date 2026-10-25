/** Real Node/SCM_RIGHTS transfer between pre-existing sibling processes. */
import { createConnection } from 'node:net';
import { once } from 'node:events';
const [mode, path] = process.argv.slice(2);
let socket;
process.on('message', async (message, handle) => {
  try {
    if (message.op === 'adopt') { socket = handle; socket.pause(); process.send({ adopted: true, pid: process.pid }); }
    else if (message.op === 'handoff') process.send({ transferred: true, pid: process.pid }, socket, { keepOpen: true });
    else if (message.op === 'write') {
      await new Promise((resolve, reject) => socket.write(Buffer.from(message.hex, 'hex'), error => error ? reject(error) : resolve()));
      process.send({ written: true, pid: process.pid });
    } else if (message.op === 'alive') process.send({ alive: true, pid: process.pid });
    else if (message.op === 'close') { socket?.destroy(); process.disconnect(); }
    else throw new Error('unknown transfer fixture request');
  } catch (error) { process.send({ failed: true, message: error.message }); }
});
if (mode === 'connector') {
  socket = createConnection(path); socket.on('error', () => {}); await once(socket, 'connect'); socket.pause();
} else if (mode !== 'holder') throw new Error('unknown transfer fixture mode');
process.send({ ready: true, pid: process.pid });
