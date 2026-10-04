import {createHash} from 'node:crypto';
const fault=code=>Object.assign(new Error(code),{code});
// Completion metadata is derived from uploaded private bytes, never a browser claim.
export async function verifyCompletionEvidence(manifest,readPhoto){
 if(!Array.isArray(manifest)||!manifest.length)throw fault('EVIDENCE_REQUIRED');
 if(manifest.length>3)throw fault('UNAVAILABLE');
 for(const [i,p] of manifest.entries()){
  if(!p||p.slot!==i+1||!['image/jpeg','image/png','image/webp'].includes(p.mime_type)||!Number.isInteger(p.size_bytes)||p.size_bytes<128||p.size_bytes>900000||typeof p.sha256!=='string'||!/^[0-9a-f]{64}$/.test(p.sha256))throw fault('UNAVAILABLE');
  const photo=await readPhoto(p.slot);const bytes=Buffer.from(photo.bytes);
  const validMime=p.mime_type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
   p.mime_type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
   bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(photo.mime!==p.mime_type||bytes.length!==p.size_bytes||!validMime||createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw fault('UNAVAILABLE');
 }
 return manifest.map(p=>({slot:p.slot,mime_type:p.mime_type,size_bytes:p.size_bytes,sha256:p.sha256}));
}
