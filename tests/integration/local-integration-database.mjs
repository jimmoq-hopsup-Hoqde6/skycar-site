// Validate the client destination, not inet_server_addr(): Docker port forwarding
// connects to localhost while PostgreSQL correctly sees its container interface.
// Disallow libpq routing overrides so a localhost-looking URI cannot target a host
// or database supplied through connection parameters or ambient service settings.
export function assertLocalIntegrationDatabase(database, env = process.env) {
  const refused = 'Refusing database tests: only an explicit local disposable skycar_integration_test URL without connection overrides is permitted.';
  let url;
  try { url = new URL(database); } catch { throw new Error(refused); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.pathname !== '/skycar_integration_test'
    || url.search || url.hash
    || env.PGHOSTADDR || env.PGSERVICE) {
    throw new Error(refused);
  }
  return database;
}
