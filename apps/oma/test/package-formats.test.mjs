import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_INDEX, PACKAGE_INDEX_KIND, encodePackageIndex, readPackageIndex } from '../dist/runtime/packages/index.js';
import { readPersonalSettings } from '../dist/runtime/personal-settings.js';
function fixture(t) { const root=mkdtempSync(join(tmpdir(),'oma-current-package-format-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root; }
const current = {source:'npm:fixture',entries:[],skills:[],prompts:[],themes:[]};
test('Current package index has one explicit file kind and mandatory resource lists', t => {
 const root=fixture(t),path=join(root,PACKAGE_INDEX);
 writeFileSync(path,encodePackageIndex([current])); assert.deepEqual(readPackageIndex(root),[current]);
 for(const packages of [[{source:'npm:fixture',entries:[]}],[{...current,unexpected:true}]]) {
  const bytes=JSON.stringify({kind:PACKAGE_INDEX_KIND,packages});writeFileSync(path,bytes);
  assert.throws(()=>readPackageIndex(root),{code:'STORE_CORRUPT'});assert.equal(readFileSync(path,'utf8'),bytes);
 }
});
test('Previous or future package index formats refuse with their exact bytes retained', t => {
 const root=fixture(t),path=join(root,PACKAGE_INDEX);
 for(const value of [[current],{kind:'oma-installed-packages-v2',packages:[current]}]) {
  const bytes=JSON.stringify(value);writeFileSync(path,bytes);
  assert.throws(()=>readPackageIndex(root),{code:'UNSUPPORTED_PROFILE'});assert.equal(readFileSync(path,'utf8'),bytes);
 }
});
test('Previous Personal settings are refused without rewriting identity or saved choices', t => {
 const root=fixture(t);mkdirSync(join(root,'.personal'));const path=join(root,'.personal/settings.json');
 const bytes=JSON.stringify({kind:'oma-personal-settings-v1',revision:7,extensions:[],packages:[current]});writeFileSync(path,bytes);
 assert.throws(()=>readPersonalSettings(root),{code:'UNSUPPORTED_PROFILE'});assert.equal(readFileSync(path,'utf8'),bytes);
});
