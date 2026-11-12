const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(value,k));
const instant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:[.]\d{1,6})?(?:[Zz]|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
export function readTechnicianCommand(value){
  if(!exact(value,['action','payload'])||!['quote','decline','start','complete'].includes(value.action))throw new Error('Unsupported technician command');
  const p=value.payload;
  if(['decline','start','complete'].includes(value.action)){if(!exact(p,[]))throw new Error('Unsupported command payload');return value;}
  if(!exact(p,['scope_summary','total_price_cents','expires_at','starts_at','ends_at'])||typeof p.scope_summary!=='string'||p.scope_summary.trim().length<10||p.scope_summary.trim().length>2000||
    !Number.isInteger(p.total_price_cents)||p.total_price_cents<1||p.total_price_cents>100000000||![p.expires_at,p.starts_at,p.ends_at].every(instant)||
    Date.parse(p.expires_at)>Date.parse(p.starts_at)||Date.parse(p.ends_at)<=Date.parse(p.starts_at)||Date.parse(p.ends_at)-Date.parse(p.starts_at)>7*86400000)throw new Error('Unsupported quote');
  return value;
}
export function readTechnicianCommandResult(value,id,action){
  if(!exact(value,['id','action','state','quote_id','replayed'])||value.id!==id||!uuid(value.id)||value.action!==action||typeof value.replayed!=='boolean')throw new Error('Unsupported technician command result');
  const valid=action==='complete'?value.state==='completed'&&value.quote_id===null:action==='start'?value.state==='in_progress'&&value.quote_id===null:
    action==='quote'?value.state==='quotes_ready'&&uuid(value.quote_id):
    action==='decline'&&['review','quotes_ready'].includes(value.state)&&value.quote_id===null;
  if(!valid)throw new Error('Unsupported technician command result');
  return value;
}
export function readOwnTechnicianQuotes(value){
  if(!Array.isArray(value)||value.length>20||new Set(value.map(q=>q?.id)).size!==value.length||value.some(q=>!exact(q,['id','scope_summary','total_price_cents','currency','status','expires_at','starts_at','ends_at'])||
    !uuid(q.id)||typeof q.scope_summary!=='string'||q.scope_summary.trim().length<10||q.scope_summary.length>2000||!Number.isInteger(q.total_price_cents)||q.total_price_cents<1||q.total_price_cents>100000000||q.currency!=='AUD'||
    !['issued','selected','superseded','withdrawn'].includes(q.status)||![q.expires_at,q.starts_at,q.ends_at].every(instant)||Date.parse(q.expires_at)>Date.parse(q.starts_at)||Date.parse(q.ends_at)<=Date.parse(q.starts_at)))throw new Error('Unsupported own quotes');
  return value;
}
export function quotePriceCents(value){const text=String(value).trim();if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(text))throw new Error('Enter an AUD price with up to two decimal places.');const cents=Math.round(Number(text)*100);if(cents<1||cents>100000000)throw new Error('Enter a price between $0.01 and $1,000,000.');return cents;}
export function quoteInstant(value){const date=new Date(String(value));if(!Number.isFinite(date.getTime()))throw new Error('Enter valid appointment and expiry times.');return date.toISOString();}
