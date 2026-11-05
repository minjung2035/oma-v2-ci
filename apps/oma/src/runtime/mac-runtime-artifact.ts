/** Disposable generation metadata and held-directory mechanics. This grants
 * no execution/Actor authority; startup collection requires the application's
 * genuine recovered execution window, before listener/admission readiness. */
import {closeSync,constants,fchmodSync,fstatSync,fsyncSync,readFileSync,writeSync} from 'node:fs';
import {basename,dirname,join,relative,resolve} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {directoryNames} from '@oma/file-descriptors';
import {openBeneath,openDirectory,openRegularBeneath} from '@oma/native/files';
import {statAt,readlinkBytesAt} from '@oma/native/posix-files';
import {withCleanup,withIteratorCleanup} from '@oma/native/cleanup';
import {darwinOwnedEntryFlags,setDarwinUserImmutable} from '@oma/native/darwin-file-flags';
import {assertHostDirectoryLayout} from '@oma/native/directory-layout';
import {removeOwnedTreeAt} from '@oma/storage/directory';
import {decodeUtf8} from '@oma/domain/utf8';
import {StoreError} from '@oma/domain/errors';
import {isDeploymentDigest} from '@oma/domain/deployment';

export const GENERATION_OWNER = '.oma-generation-owner.json';
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const FINAL=new RegExp('^\\.oma-runtime-'+UUID+'$'),OPENING=new RegExp('^\\.oma-runtime-opening-'+UUID+'$');
const MAX_OWNER_BYTES=1073741824;
interface Identity {readonly dev:string;readonly ino:string}
export interface GenerationPlan {
 readonly files:readonly string[];readonly directories:readonly string[];
 readonly links:readonly {readonly path:string;readonly target:string}[];
}
interface Owner extends GenerationPlan {
 readonly version:1;readonly name:string;readonly uid:number;readonly parent:Identity;readonly root:Identity;readonly deploymentDigest:string;
}
const held=new Set<string>();
const identity=(fd:number):Identity=>{const s=fstatSync(fd,{bigint:true});return{dev:String(s.dev),ino:String(s.ino)};};
const key=(id:Identity):string=>id.dev+':'+id.ino;
const same=(a:Identity,b:Identity):boolean=>a.dev===b.dev&&a.ino===b.ino;
const fail=(message:string):never=>{throw new StoreError('RUN_TERMINATION_UNKNOWN',message);};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[]):boolean=>Object.keys(v).sort().join()===keys.sort().join();
const path=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&!v.includes('\\')&&!v.includes('\0')&&!v.startsWith('/')&&v.split('/').every(p=>p!==''&&p!=='.'&&p!=='..');
function owned(fd:number,directory:boolean):Identity{
 const s=fstatSync(fd);if(s.uid!==process.getuid?.()||(directory?!s.isDirectory()||(s.mode&0o077)!==0:!s.isFile()||s.nlink!==1))fail('runtime artifact is not an owned independent inode');
 return identity(fd);
}
export function retainRuntimeArtifact(fd:number):()=>void{
 const id=key(owned(fd,true));if(held.has(id))fail('runtime artifact already has a live producer');held.add(id);
 let returned=false;return()=>{if(!returned){returned=true;held.delete(id);}};
}
/** Publish this marker before any runtime payload is copied into a final name. */
export function writeRuntimeArtifactOwner(parent:number,root:number,name:string,deploymentDigest:string,plan:GenerationPlan):void{
 if(!FINAL.test(name)||!isDeploymentDigest(deploymentDigest))throw new TypeError('invalid runtime artifact selection');
 const bytes=Buffer.from(JSON.stringify({version:1,name,uid:process.getuid!(),parent:owned(parent,true),root:owned(root,true),deploymentDigest,
  files:plan.files,directories:plan.directories,links:plan.links} satisfies Owner));
 if(bytes.length>MAX_OWNER_BYTES)fail('runtime artifact metadata exceeds its supported bound');
 const fd=openBeneath(root,GENERATION_OWNER,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
 withCleanup(()=>{for(let at=0;at<bytes.length;){const count=writeSync(fd,bytes,at,bytes.length-at,at);if(!count)fail('runtime artifact metadata write stopped');at+=count;}fchmodSync(fd,0o400);fsyncSync(fd);},()=>closeSync(fd));
 fsyncSync(root);
}
export function readRuntimeArtifactOwner(parent:number,root:number,name:string):Owner{
 const fd=openRegularBeneath(root,GENERATION_OWNER);
 return withCleanup(()=>{
  owned(fd,false);const before=fstatSync(fd,{bigint:true});if(before.size<1n||before.size>BigInt(MAX_OWNER_BYTES))fail('runtime artifact metadata size is unsupported');
  const bytes=readFileSync(fd),after=fstatSync(fd,{bigint:true});
  if(BigInt(bytes.length)!==before.size||['dev','ino','size','mtimeNs','ctimeNs'].some(k=>before[k as 'dev']!==after[k as 'dev']))fail('runtime artifact metadata changed during read');
  const value:unknown=JSON.parse(decodeUtf8(bytes));
  if(!object(value)||!exact(value,['version','name','uid','parent','root','deploymentDigest','files','directories','links'])||value.version!==1||value.name!==name||value.uid!==process.getuid?.()||!isDeploymentDigest(value.deploymentDigest)||
   !object(value.parent)||!exact(value.parent,['dev','ino'])||!object(value.root)||!exact(value.root,['dev','ino'])||
   typeof value.parent.dev!=='string'||typeof value.parent.ino!=='string'||typeof value.root.dev!=='string'||typeof value.root.ino!=='string'||
   !same(value.parent as unknown as Identity,owned(parent,true))||!same(value.root as unknown as Identity,owned(root,true))||
   !Array.isArray(value.files)||!value.files.every(path)||!Array.isArray(value.directories)||!value.directories.every(path)||!Array.isArray(value.links)||
   !value.links.every(link=>object(link)&&exact(link,['path','target'])&&path(link.path)&&path(link.target)))fail('runtime artifact ownership metadata is not bound to this generation');
  const result=value as unknown as Owner,all=[...result.files,...result.directories,...result.links.map(link=>link.path)];
  if(all.length>131072||new Set(all).size!==all.length||!result.files.includes(GENERATION_OWNER)||!result.files.includes('.oma-node-bin/node')||!result.directories.includes('.oma-node-bin'))fail('runtime artifact plan is invalid');
  const directoryNamesSet=new Set(result.directories),fileNamesSet=new Set(result.files);
  for(const entry of all)for(let p=dirname(entry);p!=='.';p=dirname(p))if(!directoryNamesSet.has(p))fail('runtime artifact plan omits a parent');
  for(const link of result.links)if(!fileNamesSet.has(link.target)&&!directoryNamesSet.has(link.target))fail('runtime artifact link target is not selected');
  return result;
 },()=>closeSync(fd));
}
interface Entry extends Identity{readonly path:string;readonly directory:boolean}
function* collect(parent:number,name:string):Generator<void,void,void>{
 const root=openBeneath(parent,name,constants.O_RDONLY|constants.O_DIRECTORY);
 yield* withIteratorCleanup(function*(){
  const rootId=owned(root,true);if(held.has(key(rootId)))fail('runtime generation is still owned by a live producer');
  if(OPENING.test(name)){
   // No payload is written before the exclusive final-name publication.
   for(const child of directoryNames(root)){if(child!==GENERATION_OWNER)fail('opening runtime artifact contains an unrecognized entry');const fd=openRegularBeneath(root,child);withCleanup(()=>{owned(fd,false);if(fstatSync(fd).size>MAX_OWNER_BYTES)fail('opening metadata exceeds bound');},()=>closeSync(fd));yield;}
  }else{
   const plan=readRuntimeArtifactOwner(parent,root,name),files=new Set(plan.files),dirs=new Set(plan.directories),links=new Map(plan.links.map(l=>[l.path,l.target])),entries:Entry[]=[{path:'.',directory:true,...rootId}];
   const inspect=function*(fd:number,prefix:string):Generator<void,void,void>{
    for(const child of directoryNames(fd)){
     const p=prefix?prefix+'/'+child:child,s=statAt(fd,child);
     if(s.isSymbolicLink()){
      const target=links.get(p);if(target===undefined||decodeUtf8(readlinkBytesAt(fd,child))!==relative(dirname(p),target))fail('runtime artifact has an unrecognized link');
     }else{
      const directory=s.isDirectory();if(!(directory?dirs:files).has(p)||!directory&&!s.isFile())fail('runtime artifact contains an unrecognized entry');
      const opened=directory?openBeneath(fd,child,constants.O_RDONLY|constants.O_DIRECTORY):openRegularBeneath(fd,child);
      yield* withIteratorCleanup(function*(){const id=owned(opened,directory);if(id.dev!==rootId.dev)fail('runtime artifact crosses a filesystem');entries.push({path:p,directory,...id});if(directory)yield*inspect(opened,p);yield;},()=>closeSync(opened));
     }
     yield;
    }
   };
   yield*inspect(root,'');
   // Inspect the complete plan before changing any inode flags.
   const children=new Map<string,Entry[]>();
   for(const entry of entries)if(entry.path!=='.'){const parent=dirname(entry.path),list=children.get(parent)??[];list.push(entry);children.set(parent,list);}
   const clear=function*(entry:Entry,fd:number):Generator<void,void,void>{
    if(!same(owned(fd,entry.directory),entry))fail('runtime artifact changed before collection');
    if(darwinOwnedEntryFlags(fd)&2)setDarwinUserImmutable(fd,false);yield;
    for(const child of children.get(entry.path)??[]){const opened=child.directory?openBeneath(fd,basename(child.path),constants.O_RDONLY|constants.O_DIRECTORY):openRegularBeneath(fd,basename(child.path));yield*withIteratorCleanup(()=>clear(child,opened),()=>closeSync(opened));}
   };
   yield*clear(entries[0]!,root);
  }
  const current=openBeneath(parent,name,constants.O_RDONLY|constants.O_DIRECTORY);withCleanup(()=>{if(!same(identity(current),rootId))fail('runtime artifact root changed before collection');},()=>closeSync(current));
  removeOwnedTreeAt(parent,name);fsyncSync(parent);
 },()=>closeSync(root));
}
/** Physical collection only: the application closes admission, recovers the
 * actual journal and requires no active row before entering this operation. */
export async function collectRuntimeArtifacts(parent:string,signal?:AbortSignal):Promise<void>{
 if(process.platform!=='darwin'||(process.getuid?.()??0)<=0||resolve(parent)!==parent)throw new StoreError('UNSUPPORTED_PROFILE','runtime artifact collection requires a canonical Darwin cache');
 assertHostDirectoryLayout(parent);const fd=openDirectory(parent);let failed=false,primary:unknown;
 try{
  owned(fd,true);if(fstatSync(fd).mode&0o077)fail('runtime cache must remain private');
  for(const name of directoryNames(fd))if(FINAL.test(name)||OPENING.test(name)){
   if(signal?.aborted)throw new StoreError('CANCELLED_BEFORE_COMMIT','runtime artifact collection cancelled');
   const steps=collect(fd,name);let turn=performance.now();
   try{for(;;){const step=steps.next();if(step.done)break;if(signal?.aborted){steps.throw(new StoreError('CANCELLED_BEFORE_COMMIT','runtime artifact collection cancelled'));}if(performance.now()-turn>=8){await setImmediate();turn=performance.now();}}}
   finally{steps.return();}
  }
 }catch(error){failed=true;primary=error;throw error;}
 finally{try{closeSync(fd);}catch(error){if(failed)throw new AggregateError([primary,error],'Runtime cache operation and close failed');throw error;}}
}
