import { connection } from 'next/server';
import { readSupportContact } from '@/domain/care/support-contact';
import { CareRequestForm } from '@/features/care/request-form';
export const metadata = { title:'Request using your Garage | Skycar' };
export default async function GarageCareRequestPage() { await connection(); return <CareRequestForm supportContact={readSupportContact(process.env)}/>; }
