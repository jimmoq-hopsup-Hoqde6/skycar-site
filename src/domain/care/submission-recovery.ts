// An unreadable response can only be ambiguous when transport failed before a
// response existed (status 0) or the server returned a 5xx. A received 4xx is a
// definitive rejection even if its body is malformed, so the customer must be
// allowed to correct the form and start a new idempotent attempt.
export function unreadableResponseIsUncertain(status: number) {
  return status === 0 || status >= 500;
}
