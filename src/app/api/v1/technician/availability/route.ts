import { createAvailabilityHandlers } from '@/server/technician/availability-http.mjs';
import { readTechnicianAvailability, replaceTechnicianAvailability } from '@/server/technician/availability-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createAvailabilityHandlers({
  read: readTechnicianAvailability,
  replace: replaceTechnicianAvailability,
});

export const GET = handlers.read;
export const PUT = handlers.replace;
