const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key))&&keys.every(key=>Object.hasOwn(value,key));

export function readCustomerCompletionReviewCommand(value){
 if(!exact(value,['action','payload'])||!['confirm_completion','report_completion_issue'].includes(value.action))throw new Error('Unsupported completion review command');
 if(value.action==='confirm_completion'){
  if(!exact(value.payload,[]))throw new Error('Unsupported completion review command');
 }else if(!exact(value.payload,['details'])||typeof value.payload.details!=='string'||value.payload.details.trim().length<10||value.payload.details.trim().length>2000){
  throw new Error('Unsupported completion review command');
 }
 return value;
}

export function readCustomerCompletionReviewResult(value,id,action){
 if(!exact(value,['id','state','revision','review_state','replayed'])||!uuid(id)||value.id!==id||value.state!=='completed'||
  !Number.isInteger(value.revision)||value.revision<1||typeof value.replayed!=='boolean'||
  value.review_state!==(action==='confirm_completion'?'confirmed':action==='report_completion_issue'?'issue_reported':null)){
  throw new Error('Unsupported completion review result');
 }
 return value;
}
