// Compile-time contract check (run by `npm run typecheck`, not by node --test): the typed receipt exposes the
// stored service postcode from 20261115100000 with the database's value set.
import type { CareReceipt, ServicePostcodeSource } from "../../src/domain/care/request.ts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const sourceIsExact: Equal<ServicePostcodeSource, "submit" | "update_details" | "backfill" | "unknown"> = true;
const postcodeType: Equal<NonNullable<CareReceipt["service_postcode"]>, string> = true;
const sourceType: Equal<NonNullable<CareReceipt["service_postcode_source"]>, ServicePostcodeSource> = true;
export const receiptContract = [sourceIsExact, postcodeType, sourceType];
