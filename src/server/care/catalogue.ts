import "server-only";
import { CARE_SERVICES, CareCatalogueError } from "@/domain/care/catalogue";
import { careCatalogueHandlers } from "@/server/care/catalogue-http";

export const careCatalogueApi = careCatalogueHandlers({
  services: CARE_SERVICES,
  // No authoritative coverage resolver is approved or configured yet. Fail
  // closed rather than treating a syntactically valid postcode as covered.
  resolveCoverage: async () => { throw new CareCatalogueError("COVERAGE_UNAVAILABLE"); },
});
