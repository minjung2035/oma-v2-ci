// Real PrincipalSession, core extension, broker and Open TUI; only inference is scripted.
import assert from 'node:assert/strict';
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { principalSessionDir } from "@oma/engine/principal-session";
import { startScenario } from '../../dist/test/fixtures/scenario.js';
import { call, tools, text, delayed, lastUserText } from '../../dist/test/fixtures/scripted-provider.js';
import { PanelTerminal } from '@oma/tui/panel-terminal';
import { TuiApp } from '@oma/tui/app';

const [side, ending] = process.argv.slice(2);
let session;
let resolveQuit;
const quit = new Promise(resolve => { resolveQuit = resolve; });
const terminal = new PanelTerminal({ input: process.stdin, output: process.stdout }, () => app.snapshot.open);
const app = new TuiApp({
  configFields: () => [], extensions: () => [], body: () => null,
  mail: () => ({ rows: [], unreadable: null, omitted: 0 }),
  dashboard: () => ({ status: { kind: 'unknown', observedAtMs: 0, reason: 'Fixture observation' },
    configuredWorkers: 1, unread: null, principalModel: { configured: 'scripted', session: 'scripted' },  }),
  setField: () => { throw new Error('unexpected write'); }, setExtension: () => { throw new Error('unexpected write'); },
  submitPrompt: value => session.submit(value), quit: () => resolveQuit(),
}, terminal, 262144);
app.refresh();
terminal.onKeys(bytes => app.feed(bytes));
terminal.onResize(() => app.draw());
terminal.handoff(event => session?.sendUi(event));
let panels = 0;
let sessionQueries = 0;
let settled = 0;
let markReady;
const ready = new Promise(resolve => { markReady = resolve; });
let delivered;
let mailId;
const retry = ending.startsWith('retry-'), reload = ending.startsWith('reload-');
const extension = join(dirname(side), 'reload-fixture.mjs');
const marker = join(dirname(side), 'ext-loaded.json');
const source = description => `import { writeFileSync } from 'node:fs';
export default pi => {
  // The Principal's closed tool surface never shows this extension's tool to
  // the model, so the load itself is what the marker records: which source a
  // running engine actually evaluated.
  writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ description: '${description}' }));
  process.once('exit', code => writeFileSync(${JSON.stringify(join(dirname(side), 'engine-exit.json'))}, JSON.stringify({ code })));
  pi.registerCommand('fixture-reload-failure', { description: 'Prepare fixture failure', handler(_args, ctx) {
    writeFileSync(${JSON.stringify(extension)}, 'export default () => { throw new Error("SOCIETY_RELOAD_FAILURE"); };\\n');
    ctx.ui.notify('Society reload failure prepared', 'info');
  } });
  pi.registerTool({ name: 'society_fixture', label: 'Society fixture', description: '${description}',
    parameters: { type: 'object', properties: {} }, async execute() { return { content: [], details: {} }; } });
};\n`;
if (reload) writeFileSync(extension, source('before'));
const s = await startScenario({ residents: ['worker-a'],
  ...(reload ? { extensions: [{ path: extension, sha256: createHash('sha256').update(readFileSync(extension)).digest('hex') }] } : {}),
  script: retry ? (_request, index) => {
  if (index === 0) return tools(call('oma_mail_send', { to: ['worker-a'], subject: 'Retry ownership', body: 'Exactly once.' }));
  return ending === 'retry-recover' && index === 6 ? text('RETRY_RECOVERED') : { kind: 'disconnect' };
} : [
  tools(call('oma_mail_send', { to: ['worker-a'], subject: 'Interactive ownership', body: 'Exactly once.' })),
  delayed(600, { kind: 'text', text: 'FIRST_RESPONSE_COMPLETE', thinking: 'PRIVATE_THINKING_SENTINEL' }),
  text('SECOND_RESPONSE_COMPLETE'),
], interactive: { onUi(event, live) {
  session = live;
  if (event.type === 'ready') {
    markReady();
    if (ending !== 'mail') process.stdout.write('OPEN_TUI_READY');
  }
  else if (event.type === 'sessions_request') {
    assert.equal(typeof event.id, 'string'); sessionQueries += 1;
    live.sendUi({ type: 'session_dirs', id: event.id, dirs: [] });
  }
  else if (event.type === 'quit') resolveQuit();
  else if (event.type === 'panel_open') {
    panels += 1; terminal.open(event); app.refresh();
    if (!app.snapshot.open) app.key({ kind: 'panel' }); else app.draw();
  } else if (event.type === 'panel_size') { terminal.size(event); app.draw(); }
  else if (event.type === 'panel_key' && app.snapshot.open) app.feed(Buffer.from(event.data));
} } });
s.session.onEvent(event => {
  if (event.type === 'agent_settled') {
    settled += 1;
    process.stdout.write(`RUN_SETTLED_${settled}`);
    if (ending === 'kill' && settled === 1) { process.kill(s.session.pid, 'SIGKILL'); resolveQuit(); }
    if (retry && settled === 1) resolveQuit();
    if (reload && settled === 1) writeFileSync(extension, source('after'));
  }
});
if (reload) void s.session.exited.then(resolveQuit);
try {
  if (ending === 'mail') {
    await ready;
    const sent = await s.residentSends('worker-a', { to: ['principal'], subject: 'Incoming', body: 'Mail run.' }, 'interactive-mail');
    assert.equal(sent.ok, true);
    mailId = sent.result.result.message;
    delivered = s.tick();
    const deadline = Date.now() + 20000;
    while (s.provider.seen.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(s.session.busy, 'the Human must type while delivery owns the run');
    process.stdout.write('OPEN_TUI_READY');
  }
  await quit;
  if (delivered) {
    assert.equal((await delivered).kind, 'delivered');
    assert.equal(s.store.getDelivery(mailId, 'principal')?.presented, 1);
    assert.match(lastUserText(s.provider.seen[0].body), /path=\/mail\/archive\/cur\//);
    assert.equal(lastUserText(s.provider.seen[2].body), 'Second 한글 ✅');
    assert.equal(settled, 2);
  }
  if (retry) {
    assert.equal(s.provider.seen.length, 7, 'one tool request, then initial attempt plus exactly five retries');
    const ends = s.events.filter(event => event.type === 'auto_retry_end');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].success, ending === 'retry-recover');
  }
  if (ending === 'normal') {
    assert.equal(s.provider.seen.length, 3);
    assert.equal(lastUserText(s.provider.seen[2].body), 'Second 한글 ✅');
    assert.equal(panels, 1);
  }
  if (reload) {
    await s.session.exited;
    assert.equal(JSON.parse(readFileSync(join(dirname(side), 'engine-exit.json'), 'utf8')).code, ending === 'reload-failure' ? 1 : 0);
    assert.equal(s.provider.seen.length, ending === 'reload-update' ? 3 : 2);
    // Which extension source the live engine last evaluated. 'after' proves
    // the restarted engine picked the file the first settle rewrote; a failure
    // fixture never evaluates, so the marker keeps its 'before' write.
    assert.equal(JSON.parse(readFileSync(marker, 'utf8')).description, ending === 'reload-update' ? 'after' : 'before');
    if (ending === 'reload-failure') assert.equal(readFileSync(extension, 'utf8'), 'export default () => { throw new Error("SOCIETY_RELOAD_FAILURE"); };\n');
  }
  assert.equal(s.inbox('worker-a').length, 1);
  assert.equal(s.operations('principal').filter(row => row.kind === 'mail.send').length, 1);
  assert.equal(s.provider.seen[0].body.tools.some(tool => tool.function.name === 'bash'), false);
  const history = principalSessionDir(s.root);
  const entries = readdirSync(history).filter(name => name.endsWith('.jsonl'))
    .flatMap(name => readFileSync(join(history, name), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
  if (!retry) assert.ok(entries.some(entry => entry.message?.content?.some?.(block =>
    block.type === 'thinking' && block.thinking.includes('PRIVATE_THINKING_SENTINEL'))),
    'the engine must actually record thinking before its absence on screen is evidence');
  writeFileSync(side, JSON.stringify({ requests: s.provider.seen.length, panels, settled, sessionQueries, lines: s.lines }));
} finally {
  app.close();
  await s.close();
  terminal.restore();
}
