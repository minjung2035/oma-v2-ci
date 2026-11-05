/** Trusted controlled producer. The parent owns and kills only this direct
 * unreaped child; recovery controls descendants through the actual journal. */
import{ExecutionRuntime}from'#oma-test/app/runtime/execution-runtime';
import{prepareMacRuntimeGeneration}from'#oma-test/app/runtime/mac-runtime-generation';
import{launchDarwinJobScope}from'@oma/process/darwin-execution';
import{join}from'node:path';
if(process.platform!=='darwin')throw Error('Darwin producer fixture requires the actual kernel');
const[source,node,digest,state,cache,work,mode]=process.argv.slice(2);
const runtime=new ExecutionRuntime(state,launchDarwinJobScope);await runtime.recover();
const pending=prepareMacRuntimeGeneration({libdir:source,node,deploymentDigest:digest},cache);
if(mode==='preparing')console.log(JSON.stringify({kind:'preparing'}));
const generation=await pending;
if(mode==='idle'||mode==='preparing'){if(mode==='idle')console.log(JSON.stringify({kind:'idle',root:generation.root}));setInterval(()=>{},1000);}
else{
 const ticket=await runtime.begin('resident:alice',()=>({executable:node,argv:[join(source,'apps/oma/dist/cache-probe.mjs')],env:{HOME:work,TMPDIR:work},cwd:work,timeoutMs:null,stdoutBytes:4096,stderrBytes:4096}),new AbortController().signal,()=>{},()=>{},[],{},(command,options)=>generation.launchNode(command,options));
 console.log(JSON.stringify({kind:'running',root:generation.root,witness:ticket.witness}));setInterval(()=>{},1000);
}
