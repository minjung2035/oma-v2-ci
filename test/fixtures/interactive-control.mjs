// A process-private protocol peer, not a renderer or inference provider.
import { Socket } from 'node:net';
const ui = new Socket({ fd: 6, readable: true, writable: true });
const rpc = new Socket({ fd: 5, readable: true, writable: true });
const mode = process.env.CONTROL_CASE;
const send = event => ui.write(JSON.stringify(event) + '\n');
let inputs = '';
rpc.on('data', bytes => {
  inputs += bytes.toString();
  while (inputs.includes('\n')) {
    const at = inputs.indexOf('\n');
    const request = JSON.parse(inputs.slice(0, at)); inputs = inputs.slice(at + 1);
    rpc.write(JSON.stringify({ type: 'response', command: 'prompt', id: request.id, success: true }) + '\n');
    rpc.write(JSON.stringify({ type: 'observed_prompt', text: request.message }) + '\n');
    rpc.write(JSON.stringify({ type: 'agent_settled' }) + '\n');
  }
});
ui.on('error', () => {}); rpc.on('error', () => {});
if (mode === 'silent') { /* parent startup deadline owns this peer */ }
else if (mode === 'before-ready') send({ type: 'human_input', id: 'ui-1', text: 'bad' });
else {
  send({ type: 'ready' });
  if (mode === 'ready-twice') send({ type: 'ready' });
  else if (mode === 'future') send({ type: 'human_input', id: 'ui-2', text: 'bad' });
  else if (mode === 'duplicate') {
    send({ type: 'human_input', id: 'ui-1', text: 'once' });
    send({ type: 'human_input', id: 'ui-1', text: 'once' });
  }
}
