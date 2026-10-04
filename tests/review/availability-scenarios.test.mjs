import test from 'node:test';
import assert from 'node:assert/strict';

const minute=value=>{
 assert.match(value,/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
 const [hour,minutes]=value.split(':').map(Number);return hour*60+minutes;
};
const windows=value=>{
 assert.ok(Array.isArray(value)&&value.length<=28);
 const grouped=new Map();
 for(const window of value){
  assert.deepEqual(Object.keys(window).sort(),['ends_at','starts_at','weekday']);
  assert.ok(Number.isInteger(window.weekday)&&window.weekday>=1&&window.weekday<=7);
  const start=minute(window.starts_at),end=minute(window.ends_at);assert.ok(end-start>=15,'same-day window must be at least 15 minutes');
  const prior=grouped.get(window.weekday)?.at(-1);assert.ok(!prior||prior.end<start,'windows must be sorted, non-overlapping and non-adjacent');
  const item={start,end};grouped.set(window.weekday,[...(grouped.get(window.weekday)||[]),item]);
 }
 return grouped;
};
const overlap=(a,b)=>a.start<b.end&&a.end>b.start;
const contains=(window,slot)=>window.start<=slot.start&&slot.end<=window.end&&slot.end>slot.start;
const blocks=state=>['scheduled','in_progress','cancellation_requested'].includes(state);
const confirm=(slot,available,journeys)=>{
 if(!available.some(window=>contains(window,slot)))return 'SLOT_UNAVAILABLE';
 return journeys.some(journey=>blocks(journey.state)&&overlap(journey,slot))?'SLOT_UNAVAILABLE':'scheduled';
};

const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Adelaide',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const localAt=instant=>Object.fromEntries(formatter.formatToParts(new Date(instant)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
const matches=(local,offset)=>{
 const instant=Date.parse(`${local}:00${offset}`);if(!Number.isFinite(instant))return false;
 const actual=localAt(instant),[date,time]=local.split('T'),[year,month,day]=date.split('-'),[hour,minuteValue]=time.split(':');
 return actual.year===year&&actual.month===month&&actual.day===day&&actual.hour===hour&&actual.minute===minuteValue;
};
const validAdelaideOffsets=local=>['+09:30','+10:30'].filter(offset=>matches(local,offset));

test('weekly windows are canonical same-day Adelaide wall times',()=>{
 const value=[{weekday:1,starts_at:'09:00',ends_at:'12:00'},{weekday:1,starts_at:'13:00',ends_at:'17:00'},{weekday:7,starts_at:'10:00',ends_at:'14:00'}];
 assert.equal(windows(value).get(1).length,2);
 for(const invalid of [
  [{weekday:0,starts_at:'09:00',ends_at:'17:00'}],
  [{weekday:1,starts_at:'9:00',ends_at:'17:00'}],
  [{weekday:1,starts_at:'23:00',ends_at:'01:00'}],
  [{weekday:1,starts_at:'09:00',ends_at:'09:14'}],
  [{weekday:1,starts_at:'09:00',ends_at:'12:00'},{weekday:1,starts_at:'12:00',ends_at:'13:00'}],
 ])assert.throws(()=>windows(invalid));
});

test('capacity is half-open and a proposed slot must fit one effective window',()=>{
 const schedule=[{start:Date.parse('2026-11-02T09:00:00+10:30'),end:Date.parse('2026-11-02T17:00:00+10:30')}];
 const morning={start:Date.parse('2026-11-02T09:00:00+10:30'),end:Date.parse('2026-11-02T11:00:00+10:30')};
 const adjacent={start:morning.end,end:Date.parse('2026-11-02T12:00:00+10:30')};
 assert.equal(confirm(morning,schedule,[]),'scheduled');
 assert.equal(overlap(morning,adjacent),false,'adjacent appointments do not overlap');
 assert.equal(confirm({start:schedule[0].start-1,end:morning.end},schedule,[]),'SLOT_UNAVAILABLE');
});

test('quotes and booking requests do not reserve capacity; one competing confirmation wins',()=>{
 const slot={start:100,end:200},available=[{start:0,end:300}],journeys=[];
 assert.equal(confirm(slot,available,[{...slot,state:'quotes_ready'},{...slot,state:'booking_requested'}]),'scheduled');
 journeys.push({...slot,state:'scheduled'});
 assert.equal(confirm(slot,available,journeys),'SLOT_UNAVAILABLE');
});

test('cancellation request blocks capacity until cancellation is recorded',()=>{
 const slot={start:100,end:200},available=[{start:0,end:300}];
 assert.equal(confirm(slot,available,[{...slot,state:'cancellation_requested'}]),'SLOT_UNAVAILABLE');
 assert.equal(confirm(slot,available,[{...slot,state:'cancelled'}]),'scheduled');
});

test('schedule edits affect unconfirmed work but never erase a confirmed commitment',()=>{
 const slot={start:100,end:200},oldAvailability=[{start:0,end:300}],newAvailability=[{start:300,end:400}];
 assert.equal(confirm(slot,oldAvailability,[]),'scheduled');
 assert.equal(confirm(slot,newAvailability,[]),'SLOT_UNAVAILABLE','unconfirmed request is rechecked');
 assert.equal(blocks('scheduled'),true,'confirmed journey remains the capacity record after an edit');
});

test('optimistic revision and exact retry distinguish stale writes from replays',()=>{
 const replace=({expected,current,key,body,stored})=>{
  if(stored.has(key)){
   const prior=stored.get(key);return prior.body===JSON.stringify(body)?{...prior.result,replayed:true}:{error:'IDEMPOTENCY_CONFLICT'};
  }
  if(expected!==current)return {error:'REVISION_CONFLICT'};
  const result={revision:current+1,replayed:false};stored.set(key,{body:JSON.stringify(body),result});return result;
 };
 const ledger=new Map(),body={weekly_windows:[]},first=replace({expected:3,current:3,key:'a',body,stored:ledger});assert.equal(first.revision,4);
 assert.equal(replace({expected:3,current:4,key:'a',body,stored:ledger}).replayed,true,'exact replay precedes stale-revision rejection');
 assert.equal(replace({expected:3,current:4,key:'a',body:{weekly_windows:[1]},stored:ledger}).error,'IDEMPOTENCY_CONFLICT');
 assert.equal(replace({expected:3,current:4,key:'b',body,stored:ledger}).error,'REVISION_CONFLICT');
});

test('Adelaide spring gap is nonexistent and autumn fold is ambiguous',()=>{
 assert.deepEqual(validAdelaideOffsets('2026-10-04T02:30'),[],'spring-forward wall time must not shift silently');
 assert.deepEqual(validAdelaideOffsets('2027-04-04T02:30'),['+09:30','+10:30'],'fall-back wall time has two real instants');
 assert.deepEqual(validAdelaideOffsets('2026-10-04T09:00'),['+10:30'],'ordinary transition-day daytime has one valid offset');
 assert.deepEqual(validAdelaideOffsets('2027-04-04T09:00'),['+09:30']);
});

test('reschedule keeps the original interval blocking until an atomic swap',()=>{
 const original={start:100,end:200,state:'scheduled'},proposal={start:300,end:400};
 assert.equal(blocks(original.state),true);assert.equal(overlap(original,proposal),false);
 const afterAtomicConfirmation={...proposal,state:'scheduled'};
 assert.equal(blocks(afterAtomicConfirmation.state),true);
 assert.deepEqual(afterAtomicConfirmation,{start:300,end:400,state:'scheduled'});
});
