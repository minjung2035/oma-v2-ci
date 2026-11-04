import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupAll, withCleanup, withIteratorCleanup, completeIterator } from '@oma/native/cleanup';
import { primaryFailure } from '@oma/domain/errors';
test("001. Cleanup group attempts every registered owner once and keeps thrown null/undefined", () => {
  const calls = [], primary = new Error('effect');
  let caught;
  try { withCleanup(() => { throw primary; }, () => cleanupAll([
    () => { calls.push(1); throw null; }, () => { calls.push(2); throw undefined; }, () => { calls.push(3); },
  ])); } catch (error) { caught = error; }
  assert.deepEqual(calls, [1, 2, 3]); assert.equal(primaryFailure(caught), primary);
  assert.deepEqual(caught.errors[1].errors, [null, undefined]);
});


test("002. A yielded effect retains its actual descriptor until cancellation or iterator return", async t => {
  const {mkdtempSync,writeFileSync,openSync,closeSync,fstatSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os'),{join}=await import('node:path');
  const root=mkdtempSync(join(tmpdir(),'oma-iterator-cleanup-'));t.after(()=>rmSync(root,{recursive:true}));
  const path=join(root,'held');writeFileSync(path,'owned');
  for(const ending of ['cancel','return','complete']){
    const fd=openSync(path,'r'),primary=new Error('cancel');let released=0;
    const steps=withIteratorCleanup(function*(){assert.equal(fstatSync(fd).size,5);yield;return 'done';},()=>{released++;closeSync(fd);});
    assert.equal(steps.next().done,false);assert.equal(fstatSync(fd).size,5);assert.equal(released,0);
    if(ending==='cancel')assert.throws(()=>steps.throw(primary),e=>e===primary);
    else if(ending==='return')steps.return('stopped');
    else assert.equal(completeIterator(steps),'done');
    assert.equal(released,1);assert.throws(()=>fstatSync(fd),{code:'EBADF'});steps.return('again');assert.equal(released,1);
  }
});
