import { connection } from "next/server";
import { readSupportContact } from "@/domain/care/support-contact";
import { GuestRequestForm } from "@/features/care/guest-request-form";

export const metadata = { title: "Repair or clean your car | Skycar" };

export default async function CareRequestPage({ searchParams }: { searchParams: Promise<{ service?: string | string[] }> }) {
  await connection();
  const { service } = await searchParams;
  return <GuestRequestForm initialService={service === "cleaning" ? "cleaning" : "repair"} supportContact={readSupportContact(process.env)} />;
}
