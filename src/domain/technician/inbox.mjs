import {readOwnTechnicianQuotes} from './commands.mjs';
export const technicianStates = Object.freeze(['review','quotes_ready','booking_requested','scheduled','in_progress','completed','cancellation_requested']);
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = value => value!==null && typeof value==='object' && !Array.isArray(value);
const exact = (value,keys) => object(value) && Object.keys(value).every(key=>keys.includes(key)) && keys.every(key=>Object.hasOwn(value,key));
const text = (value,max) => typeof value==='string' && value.length>0 && value.length<=max;
const date = value => typeof value==='string' && Number.isFinite(Date.parse(value));
export function readTechnicianProfile(value) {
  if(!exact(value,['expert_id','business_name','description','services','postcodes','insurance_valid_until']) || !uuid(value.expert_id) || !text(value.business_name,120) || !text(value.description,1000) ||
    !Array.isArray(value.services) || value.services.length<1 || value.services.length>2 || new Set(value.services).size!==value.services.length || value.services.some(v=>!['repair','cleaning'].includes(v)) ||
    !Array.isArray(value.postcodes) || value.postcodes.length<1 || value.postcodes.length>100 || value.postcodes.some(v=>typeof v!=='string'||!/^\d{4}$/.test(v)) || !date(value.insurance_valid_until)) throw new Error('Unsupported technician profile');
  return value;
}
/** @param {unknown} value @param {{id?:string,detail?:boolean,withPhotos?:boolean}} options */
export function readTechnicianJob(value,{id,detail=false,withPhotos=detail}={}) {
  const keys=['id','kind','vehicle','service','description','postcode','state','access','created_at','appointment','contact',...(withPhotos?['photos']:[])];
  if(!exact(value,keys) || !uuid(value.id) || (id!==undefined&&value.id!==id) || !['account','guest'].includes(value.kind) || !text(value.vehicle,250) ||
    !['repair','cleaning'].includes(value.service) || !text(value.description,4000) || typeof value.postcode!=='string' || !/^\d{4}$/.test(value.postcode) ||
    !technicianStates.includes(value.state) || !['invited','selected'].includes(value.access) || !date(value.created_at) ||
    (value.access==='invited' && (!['review','quotes_ready'].includes(value.state)||value.appointment!==null)) ||
    (value.access==='selected' && ['review','quotes_ready'].includes(value.state)) ||
    (value.appointment!==null && (!exact(value.appointment,['starts_at','ends_at'])||!date(value.appointment.starts_at)||!date(value.appointment.ends_at)||Date.parse(value.appointment.ends_at)<=Date.parse(value.appointment.starts_at))) ||
    (value.contact!==null && (!detail||value.access!=='selected'||!['scheduled','in_progress','completed'].includes(value.state)||!object(value.contact)||Object.entries(value.contact).some(([k,v])=>!['name','phone','address','suburb','postcode'].includes(k)||typeof v!=='string'||v.length>250))) ||
    (withPhotos && (!Array.isArray(value.photos)||value.photos.length>3||new Set(value.photos).size!==value.photos.length||value.photos.some(n=>!Number.isInteger(n)||n<1||n>3)))) throw new Error('Unsupported technician job');
  return value;
}
export function readTechnicianInbox(value) {
  if(!exact(value,['profile','jobs','has_more']) || !Array.isArray(value.jobs) || value.jobs.length>50 || typeof value.has_more!=='boolean') throw new Error('Unsupported technician inbox');
  readTechnicianProfile(value.profile);value.jobs.forEach(job=>readTechnicianJob(job));
  if(new Set(value.jobs.map(job=>job.id)).size!==value.jobs.length)throw new Error('Duplicate technician job');
  return value;
}
export function readTechnicianDetail(value,id) {
  if(!exact(value,['profile','job',...(Object.hasOwn(value??{},'own_quotes')?['own_quotes']:[])]))throw new Error('Unsupported technician detail');
  readTechnicianProfile(value.profile);readTechnicianJob(value.job,{id,detail:true});if(Object.hasOwn(value,'own_quotes'))readOwnTechnicianQuotes(value.own_quotes);return value;
}
