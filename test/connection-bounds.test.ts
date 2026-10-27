/** V26A: actual pinned PID2/private-channel runner floods its actor endpoint.
 * Kernel credentials, namespace lifetime and FD cleanup are production code. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACTOR_CONNECTIONS, type Broker } from "@oma/broker";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { ViewsModule } from "#oma-test/app/views";
import { testBroker } from "./helpers/broker-fixture.js";
import { preparedFixture } from "./fixtures/delivery-receipt.js";
import { nativeScriptResidents } from "./fixtures/native-script-residents.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

test("V26A: a connection flood on an actor socket is bounded, and the Resident is answered once it ends", { timeout: 60_000 }, async t => {
  const f = await preparedFixture(1), units = await nativeScriptResidents(f.store, f.root);
  let broker: Broker | undefined;
  t.after(async () => {
    await units.closeExecution();
    if (broker) { await broker.drainAndClose(); f.store.close = () => {}; }
    f.close();
  });
  const lifecycle = createLifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos/project.git"),
    society: "demo", hasGoal: () => true, activationAllowed: () => true }, () => { throw new Error("flood fixture cannot create agents"); }, f.mail);
  broker = testBroker({ store: f.store, mail: f.mail, units,
    views: new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle,
    git: null, reviews: null, reconcile: null,
    paths: { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true } });
  units.attach(broker);
  const spec = resolvedSpecOf(f.store.getAgent("alice")!); units.ensureResident("alice", spec.profile, spec.modelProfile);
  await broker.start();
  const ready = join(f.root, "flood-ready"), release = join(f.root, "flood-release"), script = join(f.root, "flood.mjs");
  writeFileSync(script, `import {Socket,connect} from 'node:net';
import {existsSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {FrameParser,encodeFrame} from ${JSON.stringify(import.meta.resolve("@oma/protocol/frame"))};
const control=new Socket({fd:6,readable:true,writable:true});
async function call(socket,frame){return new Promise((resolve,reject)=>{
 const parser=new FrameParser(${TEST_VIEW_LIMITS.frameBytes});
 const alarm=setTimeout(()=>reject(new Error('flood RPC deadline')),10000);
 socket.on('error',reject); socket.on('data',chunk=>{for(const f of parser.feed(chunk)){clearTimeout(alarm);resolve(f.raw);}});
 socket.write(encodeFrame(frame));
});}
const answer=await call(control,{v:1,id:'open',method:'runner.open',params:{agent:'alice',invocationId:process.env.OMA_TEST_INVOCATION_ID}});
if(!answer.ok)throw new Error(JSON.stringify(answer));
const flood=Array.from({length:400},()=>{const s=connect(answer.result.socketHostPath);s.on('error',()=>{});return s;});
writeFileSync(${JSON.stringify(ready)},'ready');
const deadline=performance.now()+20000;
while(!existsSync(${JSON.stringify(release)})){if(performance.now()>deadline)throw new Error('parent did not release flood');await delay(5);}
for(const s of flood)s.destroy(); await delay(300);
const socket=connect(answer.result.socketHostPath);
const result=await call(socket,{v:1,id:'after-flood',method:'status.get',params:{agent:'alice'}});
socket.destroy();control.destroy();process.stdout.write(JSON.stringify(result));
`);
  const running = units.runScript("alice", script, {}); void running.catch(() => {});
  const served = () => [...(Reflect.get(broker!, "connections") as Map<unknown, object>).values()]
    .filter(connection => !Reflect.get(connection, "options").inheritedControl).length;
  const deadline = performance.now() + 15_000;
  while (!existsSync(ready) || served() < Math.min(16, ACTOR_CONNECTIONS)) {
    assert.ok(performance.now() < deadline, "the actual actor flood never reached the listener");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(served() <= ACTOR_CONNECTIONS, `the broker served ${served()} actor connections`);
  writeFileSync(release, "release");
  const result = JSON.parse((await running).stdout.toString());
  assert.equal(result.id, "after-flood"); assert.equal(result.ok, true, JSON.stringify(result));
});
