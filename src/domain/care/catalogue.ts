export const CARE_SERVICES = Object.freeze([
  Object.freeze({ id: "repair", name: "Scratch & dent repair" }),
  Object.freeze({ id: "cleaning", name: "Detailing & cleaning" }),
] as const);

export type CareServiceId = (typeof CARE_SERVICES)[number]["id"];
export type CoverageInput = { service: CareServiceId; postcode: string };
export type Coverage = "available" | "unavailable";

export class CareCatalogueError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export function coverageInput(value: unknown): CoverageInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CareCatalogueError("VALIDATION_FAILED");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input, "service") || !Object.hasOwn(input, "postcode")) {
    throw new CareCatalogueError("VALIDATION_FAILED");
  }
  if (!CARE_SERVICES.some(item => item.id === input.service)) {
    throw new CareCatalogueError("VALIDATION_FAILED");
  }
  if (typeof input.postcode !== "string" || !/^[0-9]{4}$/.test(input.postcode)) {
    throw new CareCatalogueError("VALIDATION_FAILED");
  }
  return { service: input.service as CareServiceId, postcode: input.postcode };
}
