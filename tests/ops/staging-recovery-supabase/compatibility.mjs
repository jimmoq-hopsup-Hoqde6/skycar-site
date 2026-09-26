import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLI_VERSION,
  dumpPlan,
  encryptBundle,
  prepareDumpScript,
  runQuiet,
} from "../../../ops/staging-backup/backup.mjs";
import { decryptBundle } from "../../../ops/staging-backup/decrypt.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptRoot, "../../..");
const cli = join(
  repositoryRoot,
  "ops/staging-backup/node_modules/.bin/supabase",
);

function databaseEnv(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ""),
    PGSSLMODE: "disable",
    PGOPTIONS: "-c statement_timeout=180000",
  };
}

function query(databaseUrl, sql) {
  return runQuiet("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    env: databaseEnv(databaseUrl),
  }).trim();
}

function canonical(value) {
  if (Array.isArray(value))
    return value
      .map(canonical)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

function manifest(databaseUrl) {
  const sql = String.raw`
    SELECT jsonb_build_object(
      'serverVersion', current_setting('server_version'),
      'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'name', rolname, 'login', rolcanlogin, 'super', rolsuper,
        'replication', rolreplication, 'bypassRls', rolbypassrls
      ) ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_'), '[]'::jsonb),
      'schemas', COALESCE((SELECT jsonb_agg(nspname ORDER BY nspname)
        FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'), '[]'::jsonb),
      'extensions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'name', e.extname, 'version', e.extversion, 'schema', n.nspname
      ) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace), '[]'::jsonb),
      'parameterPrivileges', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'parameter', p.parname, 'grantee', grantee.rolname,
        'grantor', grantor.rolname, 'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      ) ORDER BY p.parname, grantee.rolname, grantor.rolname, acl.privilege_type)
        FROM pg_parameter_acl p
        CROSS JOIN LATERAL aclexplode(p.paracl) acl
        JOIN pg_roles grantee ON grantee.oid = acl.grantee
        JOIN pg_roles grantor ON grantor.oid = acl.grantor), '[]'::jsonb),
      'providerObjects', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'schema', n.nspname, 'name', c.relname, 'kind', c.relkind
      ) ORDER BY n.nspname, c.relname, c.relkind)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('auth', 'storage', 'realtime')), '[]'::jsonb)
    );`;
  return canonical(JSON.parse(query(databaseUrl, sql)));
}

function writeManifest(databaseUrl, output) {
  const value = manifest(databaseUrl);
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${sha256(Buffer.from(JSON.stringify(value)))}\n`);
}

function addFixture(databaseUrl) {
  const note = "synthetic Supabase compatibility sentinel";
  const digest = sha256(Buffer.from(note));
  const steps = [
    ["ROLE", "CREATE ROLE skycar_recovery_fixture NOLOGIN;"],
    ["GRANT", "GRANT skycar_recovery_fixture TO postgres;"],
    [
      "SCHEMA",
      "CREATE SCHEMA skycar_recovery_fixture AUTHORIZATION skycar_recovery_fixture;",
    ],
    [
      "TABLE",
      String.raw`CREATE TABLE skycar_recovery_fixture.sentinel (
        id integer PRIMARY KEY,
        note text NOT NULL,
        digest text NOT NULL
      );`,
    ],
    [
      "OWNER",
      "ALTER TABLE skycar_recovery_fixture.sentinel OWNER TO skycar_recovery_fixture;",
    ],
    [
      "INSERT",
      `INSERT INTO skycar_recovery_fixture.sentinel (id, note, digest) VALUES (7, '${note}', '${digest}');`,
    ],
    ["REVOKE", "REVOKE skycar_recovery_fixture FROM postgres;"],
  ];
  for (const [label, sql] of steps) {
    try {
      query(databaseUrl, sql);
    } catch {
      throw new Error(`FIXTURE_${label}_FAILED`);
    }
  }
}

function capture(databaseUrl, outputDirectory) {
  if (runQuiet(cli, ["--version"]).trim() !== CLI_VERSION)
    throw new Error("CLI_VERSION_MISMATCH");
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const env = {
    ...databaseEnv(databaseUrl),
    CI: "true",
    SUPABASE_TELEMETRY_DISABLED: "true",
  };
  const files = {};
  for (const [name, args] of dumpPlan(
    "postgresql://postgres:unused@localhost:5432/postgres",
  )) {
    const script = prepareDumpScript(runQuiet(cli, args, { env }));
    const sql = runQuiet("bash", ["--noprofile", "--norc"], {
      input: script,
      env,
      cwd: outputDirectory,
    });
    if (!sql.trim()) throw new Error(`EMPTY_${name}`);
    files[name] = Buffer.from(sql).toString("base64");
  }

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
  });
  const fileHashes = Object.entries(files).map(([name, value]) => ({
    name,
    sha256: sha256(Buffer.from(value, "base64")),
  }));
  const envelope = encryptBundle(files, publicKey, {
    files: fileHashes,
    applicationSha: "synthetic-local-compatibility-only",
    restoreStatus: "NOT_RUN",
  });
  const recovered = decryptBundle(envelope, privateKey);
  for (const [name, value] of Object.entries(recovered)) {
    writeFileSync(join(outputDirectory, name), Buffer.from(value, "base64"), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const roles = readFileSync(join(outputDirectory, "roles.sql"), "utf8");
  const resets = roles.match(/^RESET ALL;\r?$/gm) || [];
  if (resets.length !== 1 || !/\r?\nRESET ALL;\s*$/.test(roles)) {
    throw new Error("ROLES_RESET_CONTRACT_CHANGED");
  }
  writeFileSync(
    join(outputDirectory, "hashes.json"),
    `${JSON.stringify(fileHashes, null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
}

function decodeIdentifier(value) {
  return value.replaceAll('""', '"');
}

export function adaptRoles(raw, sourceValue, targetValue) {
  const source = canonical(sourceValue);
  const target = canonical(targetValue);
  if (JSON.stringify(source) !== JSON.stringify(target))
    throw new Error("FRESH_BASELINES_DIFFER");

  const baseline = new Set(
    target.parameterPrivileges.map((item) =>
      JSON.stringify([
        item.parameter,
        item.grantee,
        item.privilege,
        item.grantable,
      ]),
    ),
  );
  const lines = raw.split(/\r?\n/);
  let terminalResetCount = 0;
  let redundantParameterGrantCount = 0;
  const restored = [];
  for (const [index, line] of lines.entries()) {
    if (/^RESET ALL;$/.test(line)) {
      if (index !== lines.length - 2 || lines.at(-1) !== "")
        throw new Error("ROLES_RESET_NOT_TERMINAL");
      terminalResetCount += 1;
      continue;
    }
    const grant = line.match(
      /^GRANT SET ON PARAMETER "((?:[^"]|"")+)" TO "((?:[^"]|"")+)"( WITH GRANT OPTION)?;$/,
    );
    if (grant) {
      const key = JSON.stringify([
        decodeIdentifier(grant[1]),
        decodeIdentifier(grant[2]),
        "SET",
        Boolean(grant[3]),
      ]);
      if (baseline.has(key)) {
        redundantParameterGrantCount += 1;
        continue;
      }
    }
    restored.push(line);
  }
  if (terminalResetCount !== 1 || redundantParameterGrantCount < 1)
    throw new Error("ROLES_MANAGED_ADAPTATION_CONTRACT_CHANGED");
  return {
    sql: restored.join("\n"),
    terminalResetCount,
    redundantParameterGrantCount,
  };
}

function prepareRoles(rawPath, sourceBaselinePath, targetBaselinePath, output) {
  const result = adaptRoles(
    readFileSync(rawPath, "utf8"),
    JSON.parse(readFileSync(sourceBaselinePath, "utf8")),
    JSON.parse(readFileSync(targetBaselinePath, "utf8")),
  );
  writeFileSync(output, result.sql, {
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify({ terminalResetCount: result.terminalResetCount, redundantParameterGrantCount: result.redundantParameterGrantCount })}\n`,
  );
}

function describeRoles(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const value = line.trim();
    if (!value || value.startsWith("--")) continue;
    const setting = value.match(
      /^ALTER ROLE "([^"]+)"(?: IN DATABASE "[^"]+")? SET "([^"]+)" TO /,
    );
    if (setting) {
      const roleClass =
        setting[1] === "skycar_recovery_fixture"
          ? "synthetic-fixture"
          : "platform-baseline";
      process.stderr.write(
        `roles-restore-line=${index + 1} action=role-setting role-class=${roleClass} setting=${setting[2]}\n`,
      );
      continue;
    }
    const reset = /^RESET ALL;$/.test(value);
    const action = reset
      ? "session-reset"
      : value.split(/\s+/, 2).join("_").toLowerCase();
    process.stderr.write(
      `roles-restore-line=${index + 1} action=${action} statement-sha256=${sha256(Buffer.from(value))}\n`,
    );
  }
}

function ensureSubset(before, after, label) {
  const values = new Set(after.map((value) => JSON.stringify(value)));
  for (const value of before) {
    if (!values.has(JSON.stringify(value)))
      throw new Error(`BASELINE_${label}_LOST`);
  }
}

function verify(
  databaseUrl,
  sourceBaselinePath,
  targetBaselinePath,
  targetAfterPath,
  recoveredDirectory,
) {
  const source = canonical(
    JSON.parse(readFileSync(sourceBaselinePath, "utf8")),
  );
  const targetBefore = canonical(
    JSON.parse(readFileSync(targetBaselinePath, "utf8")),
  );
  const targetAfter = manifest(databaseUrl);

  if (JSON.stringify(source) !== JSON.stringify(targetBefore))
    throw new Error("FRESH_BASELINES_DIFFER");
  ensureSubset(targetBefore.roles, targetAfter.roles, "ROLES");
  ensureSubset(targetBefore.schemas, targetAfter.schemas, "SCHEMAS");
  ensureSubset(targetBefore.extensions, targetAfter.extensions, "EXTENSIONS");
  if (
    JSON.stringify(targetBefore.providerObjects) !==
    JSON.stringify(targetAfter.providerObjects)
  ) {
    throw new Error("PROVIDER_OBJECTS_CHANGED");
