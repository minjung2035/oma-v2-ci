import assert from 'node:assert/strict';
import {buildFrozenMessage} from '@oma/mail/serialize';
import {parseEmlHeaders,decodeSubject} from '@oma/mail/headers';
import {readableBody} from '@oma/mail/display';
import {expandAddresses} from '@oma/mail/routing';
import {renderBatchView} from '@oma/mail/batch-view';
import {messageIdForOperation} from '@oma/domain/derived';
const id=messageIdForOperation('op-12345678-1234-4123-8123-123456789abc',0);
const body='\uFEFFaccepted bytes\nno final newline';
const message=await buildFrozenMessage({id,sender:'alice',society:'demo',to:['commons'],kind:'message',
 contextRevision:null,dateMs:1700000000123,replyHeaders:{replyTo:['commons'],inReplyTo:null,references:[]}},
 {subject:'  folded  subject  ',body});
const headers=parseEmlHeaders(message.text);
assert.equal(headers.messageId,`${id}@demo.oma.invalid`);
assert.equal(decodeSubject(headers.subject),'  folded  subject  ');
assert.equal(readableBody(message.text),body);
const routing={listAgents:()=>[
 {name:'alice',role:'resident',desired:'enabled'},{name:'bob',role:'resident',desired:'stopped'},
 {name:'pending',role:'resident',desired:'provisioning'},{name:'principal',role:'principal',desired:'enabled'}],subscribers:()=>['bob']};
assert.deepEqual(expandAddresses(routing,['commons'],'demo').recipients,['alice','bob']);
assert.deepEqual(expandAddresses(routing,['topic/work'],'demo').recipients,['bob']);
const batch={id:'b-12345678-1234-4123-8123-123456789abc',agent:'alice',incarnation:1,messageIds:[id],
 sessionPath:null,deliveryMode:'followUp',notice:'mail',indexPath:'/inbox.md'};
const view=renderBatchView(batch,{frameBytes:256*1024,batchMaxMessages:24});
assert.deepEqual(JSON.parse(view.json).messageIds,[id]);
assert.match(view.index,new RegExp(id));
console.log('Mail installed MIME/headers/body, routing and batch rendering PASS');
