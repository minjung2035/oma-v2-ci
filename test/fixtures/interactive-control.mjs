// A process-private protocol peer, not a renderer or inference provider.
import { Socket } from 'node:net';
const ui = new Socket({ fd: 6, readable: true, writable: true });
const rpc = new Socket({ fd: 5, readable: true, writable: true });
const mode = process.env.CONTROL_CASE;
const send = event => ui.write(JSON.stringify(event) + '\n');
// AUD-03: the trusted extension's preflight refusal, on the wire the real
// interactive bridge hands the host. A delivery command the peer answers this
// way started no run: the host must return the session's claim on it.
const notStarted = (request, reason) => rpc.write(JSON.stringify({
  type: 'extension_ui_request', method: 'notify', notifyType: 'error',
  message: 'OMA_PI_DELIVERY_NOT_STARTED_V1 ' + JSON.stringify({
    adapterRevision: process.env.CONTROL_ADAPTER_REVISION ?? 'oma-pi-rpc-v1@1.0.1',
    batchId: request.message.slice('/oma-deliver '.length), reason,
  }),
}) + '\n');
const handled = request => rpc.write(JSON.stringify({ type: 'response', command: 'prompt', id: request.id, success: true, data: { disposition: 'handled' } }) + '\n');
let inputs = '', uiInputs = '', held = null, midDeliveryInput = false;
rpc.on('data', bytes => {
  inputs += bytes.toString();
  while (inputs.includes('\n')) {
    const at = inputs.indexOf('\n');
    const request = JSON.parse(inputs.slice(0, at)); inputs = inputs.slice(at + 1);
    if ((mode === 'delivery-refusal' || mode === 'delivery-queue') && request.message.startsWith('/oma-deliver ')) {
      // delivery-queue: the Human types at the engine while the claim is held,
      // and the host's answer that the prompt waits is what the refusal follows.
      if (mode === 'delivery-queue' && !midDeliveryInput) {
        midDeliveryInput = true; held = request;
        send({ type: 'human_input', id: 'ui-1', text: 'follow-up' });
        continue;
      }
      notStarted(request, 'invalid-batch'); handled(request);
      continue;
    }
    rpc.write(JSON.stringify({ type: 'response', command: 'prompt', id: request.id, success: true }) + '\n');
    rpc.write(JSON.stringify({ type: 'observed_prompt', text: request.message }) + '\n');
    rpc.write(JSON.stringify({ type: 'agent_settled' }) + '\n');
  }
});
ui.on('data', bytes => {
  uiInputs += bytes.toString();
  while (uiInputs.includes('\n')) {
    const at = uiInputs.indexOf('\n');
    const event = JSON.parse(uiInputs.slice(0, at)); uiInputs = uiInputs.slice(at + 1);
    if (held !== null && event.type === 'input_result' && event.accepted === true && event.queued === true) {
      const request = held; held = null;
      notStarted(request, 'invalid-batch'); handled(request);
    }
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
