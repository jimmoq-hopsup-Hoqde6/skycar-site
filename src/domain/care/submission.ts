import { object, uuid, type CareReceipt } from "./request.ts";
import { readReceipt } from "./presentation.ts";

export type CareSubmission = { request: CareReceipt; replayed: boolean };

// Submission responses are private and drive navigation. Reject unknown or
// future shapes rather than treating an unverified response as persistence.
export function readCareSubmission(value: unknown): CareSubmission {
  const result = object(value);
  if (Object.keys(result).length !== 2 || !("request" in result) || typeof result.replayed !== "boolean") {
    throw new Error("Unsupported submission response");
  }
  const request = object(result.request);
  const id = uuid(request.id);
  return { request: readReceipt(request, id), replayed: result.replayed };
}
