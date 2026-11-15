import {CustomerJourney} from '@/features/care/journey/customer';
export default async function Page({params}:{params:Promise<{id:string}>}){return <CustomerJourney id={(await params).id}/>;}
