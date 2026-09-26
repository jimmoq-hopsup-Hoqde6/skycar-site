import test from "node:test";
import assert from "node:assert/strict";
import { adaptRoles } from "./compatibility.mjs";

const privilege = {
  parameter: "log_min_messages",
  grantee: "supabase_admin",
  grantor: "supabase_admin",
  privilege: "SET",
  grantable: false,
};
const baseline = {
  parameterPrivileges: [privilege],
  roles: [],
  schemas: [],
  extensions: [],
  providerObjects: [],
};
const raw = `SET default_transaction_read_only = off;
CREATE ROLE "skycar_recovery_fixture";
GRANT SET ON PARAMETER "log_min_messages" TO "supabase_admin";
RESET ALL;
`;

test("managed role adapter omits only verified baseline state and terminal reset", () => {
  const result = adaptRoles(raw, baseline, structuredClone(baseline));
  assert.equal(result.terminalResetCount, 1);
  assert.equal(result.redundantParameterGrantCount, 1);
  assert.match(result.sql, /CREATE ROLE "skycar_recovery_fixture";/);
  assert.doesNotMatch(result.sql, /GRANT SET ON PARAMETER/);
  assert.doesNotMatch(result.sql, /RESET ALL/);
});

test("managed role adapter fails closed on different baselines", () => {
  const target = structuredClone(baseline);
  target.parameterPrivileges = [];
  assert.throws(
    () => adaptRoles(raw, baseline, target),
    /FRESH_BASELINES_DIFFER/,
  );
});

test("managed role adapter fails closed if expected managed grant disappears", () => {
  const empty = { ...baseline, parameterPrivileges: [] };
  assert.throws(
    () => adaptRoles(raw, empty, structuredClone(empty)),
    /ROLES_MANAGED_ADAPTATION_CONTRACT_CHANGED/,
  );
});

test("managed role adapter fails closed on nonterminal reset", () => {
  const changed = raw.replace("RESET ALL;\n", "RESET ALL;\nSELECT 1;\n");
  assert.throws(
    () => adaptRoles(changed, baseline, structuredClone(baseline)),
    /ROLES_RESET_NOT_TERMINAL/,
  );
});
