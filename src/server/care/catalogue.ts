import "server-only";
import { CARE_SERVICES } from "@/domain/care/catalogue";
import { careCatalogueHandlers } from "@/server/care/catalogue-http";
import { createCoverageResolver } from "@/server/care/coverage-resolver";
import coverageAreas from "@/server/care/coverage-areas.json";

export const careCatalogueApi = careCatalogueHandlers({
  services: CARE_SERVICES,
  // The launch area (Adelaide metro plus Adelaide Hills) is data, not code: see coverage-areas.json
  // and docs/contracts/service-coverage.md. If that data is unusable the resolver throws and the
  // route answers 503 COVERAGE_UNAVAILABLE (fail closed).
  resolveCoverage: createCoverageResolver(coverageAreas),
});
