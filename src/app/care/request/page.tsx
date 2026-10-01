import { GuestRequestForm } from "@/features/care/guest-request-form";

export const metadata = { title: "Repair or clean your car | Skycar" };

export default async function CareRequestPage({ searchParams }: { searchParams: Promise<{ service?: string | string[] }> }) {
  const { service } = await searchParams;
  return <GuestRequestForm initialService={service === "cleaning" ? "cleaning" : "repair"} />;
}
