import { CareCatalogueError, type Coverage, type CoverageInput } from "../../domain/care/catalogue.ts";

// Reads the launch service area from ONE data file (coverage-areas.json, generated from ABS data by
// scripts/coverage-data/build-coverage-areas.py). Nothing in this module lists a postcode.
//
// Fail-closed rules: if the data is missing, malformed, empty, internally inconsistent with its own
// stated rule, or does not know the requested service, the resolver throws COVERAGE_UNAVAILABLE.
// An unreadable list therefore never turns into "everything is out of area" or "everything is covered".

const POSTCODE = /^[0-9]{4}$/;
const unavailable = () => new CareCatalogueError("COVERAGE_UNAVAILABLE");

type Candidate = { postcode: string; gccsa_greater_adelaide: number; lga_adelaide_hills: number; lga_mount_barker: number; included: boolean };

export type CoverageIndex = ReadonlyMap<string, ReadonlySet<string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function ratio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1.000001) throw unavailable();
  return value;
}

export function buildCoverageIndex(data: unknown): CoverageIndex {
  if (!isRecord(data) || typeof data.version !== "string" || typeof data.areaId !== "string") throw unavailable();
  const rule = data.rule;
  if (!isRecord(rule) || typeof rule.threshold !== "number" || !(rule.threshold > 0 && rule.threshold <= 1)) throw unavailable();
  if (!Array.isArray(data.candidates) || data.candidates.length === 0) throw unavailable();
  const included = new Set<string>();
  const seen = new Set<string>();
  for (const raw of data.candidates as unknown[]) {
    if (!isRecord(raw) || typeof raw.postcode !== "string" || !POSTCODE.test(raw.postcode) || typeof raw.included !== "boolean") throw unavailable();
    if (seen.has(raw.postcode)) throw unavailable();
    seen.add(raw.postcode);
    const c = raw as unknown as Candidate;
    // Every inclusion must be re-derivable from the stored ABS ratios; a hand-edited flag is rejected.
    const derived = ratio(c.gccsa_greater_adelaide) >= rule.threshold || ratio(c.lga_adelaide_hills) + ratio(c.lga_mount_barker) >= rule.threshold;
    if (derived !== c.included) throw unavailable();
    if (c.included) included.add(c.postcode);
  }
  if (included.size === 0 || !isRecord(data.services)) throw unavailable();
  const index = new Map<string, ReadonlySet<string>>();
  for (const [service, areas] of Object.entries(data.services)) {
    if (!Array.isArray(areas) || areas.length === 0 || areas.some(area => area !== data.areaId)) throw unavailable();
    index.set(service, included);
  }
  return index;
}

export function createCoverageResolver(data: unknown) {
  let index: CoverageIndex | null = null;
  return async function resolveCoverage(input: CoverageInput): Promise<Coverage> {
    index ??= buildCoverageIndex(data);
    const postcodes = index.get(input.service);
    if (!postcodes) throw unavailable();
    return postcodes.has(input.postcode) ? "available" : "unavailable";
  };
}
