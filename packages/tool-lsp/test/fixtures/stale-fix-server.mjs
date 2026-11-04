import {writeFileSync, watch, existsSync} from 'node:fs';
import {join} from 'node:path';
const root = process.argv[2];
let buffer = Buffer.alloc(0), opened;
const reply = (id,result) => {const body=JSON.stringify({jsonrpc:'2.0',id,result});process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);};
async function message(m) {
 if (m.method==='initialize') return reply(m.id,{capabilities:{diagnosticProvider:{interFileDependencies:false,workspaceDiagnostics:false},codeActionProvider:true,textDocumentSync:1}});
 if (m.method==='textDocument/didOpen') {opened=m.params.textDocument; return;}
 if (m.method==='textDocument/diagnostic') return reply(m.id,{kind:'full',items:[]});
 if (m.method==='textDocument/codeAction') {
  const gate=join(root,'release-action');
  const released=new Promise(resolve=>{const observer=watch(root,()=>{if(existsSync(gate)){observer.close();resolve();}});if(existsSync(gate)){observer.close();resolve();}});
  writeFileSync(join(root,'action-ready'),'ready');
  await released;
  const column=opened.text.split('\n')[0].indexOf('1');
  return reply(m.id,[{title:'Change first constant',kind:'source.fixAll',edit:{documentChanges:[{textDocument:{uri:opened.uri,version:opened.version},edits:[{range:{start:{line:0,character:column},end:{line:0,character:column+1}},newText:'2'}]}]}}]);
 }
 if(m.method==='shutdown') return reply(m.id,null);
 if(m.method==='exit') process.exit(0);
 if(m.id!==undefined) reply(m.id,null);
}
process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const end=buffer.indexOf('\r\n\r\n');if(end<0)return;const length=Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0,end).toString())[1]);if(buffer.length<end+4+length)return;const m=JSON.parse(buffer.subarray(end+4,end+4+length));buffer=buffer.subarray(end+4+length);void message(m).catch(error=>{console.error(error);process.exit(1);});}});
