// Run: node lib/conversation-cloud.check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const loaded = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/conversation-cloud.ts','utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS} }).outputText, {
  module:loaded,exports:loaded.exports,require:()=>({}),
});
const { mergeConversation, conversationParts } = loaded.exports;
const user = (id,text) => ({id,role:'user',text});
const answer = (id,text) => ({id,role:'assistant',text,questions:[],picked:[]});
const base = {id:'thread',startedAt:'2026-10-26T00:00:00.000Z',updatedAt:'2026-10-26T00:01:00.000Z',gadget:null,turns:[user('u0','Screen issue'),answer('a0','Try restarting')]};
const remote = {...base,turns:[base.turns[0],{...base.turns[1],saved:true},user('u1','Still flickers'),answer('a1','Check the cable')]};
const local = {...base,turns:[...base.turns,user('u2','Can I use it?'),answer('a2','Switch it off')]};
const merged = mergeConversation(remote,base,local);
assert.equal(merged.turns.length,6,'Concurrent follow-ups must retain both devices’ messages');
assert.equal(merged.turns[1].saved,true,'An unrelated follow-up must preserve the other device’s bookmark');
assert.equal(merged.turns.at(-1).id,'a2');
const unmarked = mergeConversation(merged,remote,{...remote,turns:remote.turns.map(turn=>turn.id==='a0'?{...turn,saved:false}:turn)});
assert.equal(unmarked.turns[1].saved,false,'Removing a bookmark must sync');
assert.equal(unmarked.turns.length,6,'Bookmark edits must not discard newer messages');
assert.equal(mergeConversation(merged,undefined,local).turns.length,6,'Retrying an append must not duplicate messages');
const legacy=mergeConversation(base,base,{...base,turns:base.turns.map(({id,...turn})=>turn)});
assert.ok(legacy.turns.every(turn=>typeof turn.id==='string'));
for(const offset of [0,1]){
  const conversation={...base,turns:[user('photo','x'.repeat(199900+offset)+'😀'.repeat(200)),{...user('u-photo','Photo'),image:'data:image/jpeg;base64,'+'A'.repeat(1300000)}]};
  const parts=conversationParts(conversation);
  assert.ok(parts.length>5,'Large photos must be split across documents');
  for(const part of parts){
    assert.ok(part.length<=200000);
    assert.ok(Buffer.byteLength(part,'utf8')<1048576,'Every part must fit Firestore’s document size');
    assert.ok(!/[\uD800-\uDBFF]$/.test(part),'A part must not split an emoji');
  }
  const restored=JSON.parse(parts.map(part=>Buffer.from(part,'utf8').toString('utf8')).join(''));
  assert.equal(JSON.stringify(restored),JSON.stringify(conversation),'UTF-8 transport must preserve photos and emoji exactly');
}
console.log('conversation-cloud.check: concurrent replies, bookmark edits, retry deduplication, large photos and emoji passed');
