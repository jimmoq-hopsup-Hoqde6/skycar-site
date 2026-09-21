import RequestStatus from "./request-status";

export const metadata = { title: "Your Care request | Skycar", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestStatus key={id} id={id} />;
}
