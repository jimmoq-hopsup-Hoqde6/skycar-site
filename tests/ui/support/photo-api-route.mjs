// URL predicates avoid version-dependent glob handling of a trailing `id**`.
// The slash boundary is important: another request with the same prefix is not in scope.
export function photoApiRoute(origin, path) {
  return url => url.origin === origin && (url.pathname === path || url.pathname.startsWith(`${path}/`));
}
