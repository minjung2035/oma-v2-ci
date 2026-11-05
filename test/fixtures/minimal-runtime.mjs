/** Small actual deployment inventory for native lifecycle fixtures only. */
import{mkdirSync,writeFileSync,readFileSync,symlinkSync,realpathSync}from'node:fs';
import{dirname,join}from'node:path';
import{DEPLOYMENT_LAYOUT}from'@oma/domain/deployment';
import{bundledJobHelper}from'@oma/native/darwin-job-launch';
import{bundledSeatbeltHelper}from'@oma/platform-mac/seatbelt';
import{deploymentDigest}from'#oma-test/app/runtime/deployment-manifest';
export function minimalRuntime(source,entryText){
 mkdirSync(join(source,'node_modules/@oma'),{recursive:true});const packages={'':{name:'minimal-native-fixture'}};
 for(const w of DEPLOYMENT_LAYOUT.workspaces){mkdirSync(join(source,w.root,'dist'),{recursive:true});writeFileSync(join(source,w.root,'package.json'),JSON.stringify({name:w.name,version:'0.1.0',type:'module',exports:{'.':'./dist/index.js'}}));writeFileSync(join(source,w.root,'dist/index.js'),'export {};\n');symlinkSync(join(source,w.root),join(source,'node_modules',w.name));packages['node_modules/'+w.name]={resolved:w.root,link:true};}
 writeFileSync(join(source,'package.json'),JSON.stringify({name:'minimal-native-fixture',type:'module'}));writeFileSync(join(source,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages}));writeFileSync(join(source,DEPLOYMENT_LAYOUT.schema),'fixture bytes');
 for(const[path,actual]of[['job-helper/oma-job-helper',bundledJobHelper()],['seatbelt/oma-seatbelt',bundledSeatbeltHelper()]]){const target=join(source,'packages/native/dist',path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,process.platform==='darwin'?readFileSync(actual):Buffer.from('Darwin fixture only'),{mode:0o500});}
 const entry=join(source,'apps/oma/dist/cache-probe.mjs');writeFileSync(entry,entryText);
 return{installation:{libdir:source,node:realpathSync(process.execPath),deploymentDigest:deploymentDigest(source)},entry};
}
