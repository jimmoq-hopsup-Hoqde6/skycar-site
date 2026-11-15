import {TechnicianInbox} from '@/features/technician/inbox';
export const dynamic='force-dynamic';
export const metadata={title:'Technician job review | Skycar'};
export default async function Page({params}:{params:Promise<{id:string}>}){return <TechnicianInbox id={(await params).id}/>;}
