npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
tests/ops/staging-recovery-supabase/compatibility.mjs 69ms (unchanged)
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
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  for (const [name, value] of Object.entries(recovered)) {
    writeFileSync(join(outputDirectory, name), Buffer.from(value, "base64"), {
      mode: 0o600,
      flag: "wx",
    });
  }
  writeFileSync(
    join(outputDirectory, "hashes.json"),
    `${JSON.stringify(fileHashes, null, 2)}\n`,
    { mode: 0o600, flag: "wx" },
  );
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
  }

  const expectedSchemas = new Set([
    ...targetBefore.schemas,
    "skycar_recovery_fixture",
  ]);
  if (
    targetAfter.schemas.length !== expectedSchemas.size ||
    !targetAfter.schemas.every((value) => expectedSchemas.has(value))
  ) {
    throw new Error("UNEXPECTED_SCHEMA_DELTA");
  }
  const expectedRoleNames = new Set([
    ...targetBefore.roles.map((role) => role.name),
    "skycar_recovery_fixture",
  ]);
  if (
    targetAfter.roles.length !== expectedRoleNames.size ||
    !targetAfter.roles.every((role) => expectedRoleNames.has(role.name))
  ) {
    throw new Error("UNEXPECTED_ROLE_DELTA");
  }

  const sentinel = query(
    databaseUrl,
    `
    SELECT note || '|' || digest
    FROM skycar_recovery_fixture.sentinel WHERE id = 7;
  `,
  );
  const expectedNote = "synthetic Supabase compatibility sentinel";
  if (sentinel !== `${expectedNote}|${sha256(Buffer.from(expectedNote))}`)
    throw new Error("SENTINEL_MISMATCH");

  const hashes = JSON.parse(
    readFileSync(join(recoveredDirectory, "hashes.json"), "utf8"),
  );
  for (const item of hashes) {
    if (
      sha256(readFileSync(join(recoveredDirectory, item.name))) !== item.sha256
    )
      throw new Error("RECOVERED_HASH_MISMATCH");
  }

  writeFileSync(targetAfterPath, `${JSON.stringify(targetAfter, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${sha256(Buffer.from(JSON.stringify(targetAfter)))}\n`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "status-db") {
  const value = JSON.parse(readFileSync(args[0], "utf8"));
  const url = value.DB_URL || value.db_url || value.database_url;
  if (!url || !/^postgresql?:\/\//.test(url))
    throw new Error("LOCAL_DB_URL_MISSING");
  process.stdout.write(url);
} else if (command === "manifest") {
  writeManifest(args[0], args[1]);
} else if (command === "fixture") {
  addFixture(args[0]);
} else if (command === "capture") {
  capture(args[0], args[1]);
} else if (command === "verify") {
  verify(...args);
} else {
  throw new Error("UNKNOWN_COMPATIBILITY_COMMAND");
}
