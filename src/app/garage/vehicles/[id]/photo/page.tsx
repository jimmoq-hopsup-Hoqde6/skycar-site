import { VehiclePhoto } from '@/features/garage/vehicle-photo';

export const metadata = { title: 'Vehicle photo | Skycar' };

export default async function VehiclePhotoPage({ params }: { params: Promise<{ id: string }> }) {
  return <VehiclePhoto vehicleId={(await params).id} />;
}
