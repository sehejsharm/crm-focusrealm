import { parseArgs } from "node:util";
import { connect, db, migrate } from "../db/index.js";
import { hashPassword, temporaryPassword } from "../lib/auth.js";

/**
 * Creates a CRM login from the command line — for the very first founder on
 * a fresh database (everyone else can be added in People & Access, and sales
 * team members arrive from the HR console).
 *
 *   DATABASE_URL=… npm run create-user -- --id FR-0001 --name "Your Name" \
 *     --email you@focusrealm.com --role founder --title "Co-founder & CEO"
 *
 * Prints a temporary password once; it must be changed at first sign-in.
 */
const { values } = parseArgs({
  options: {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    role: { type: "string", default: "founder" },
    title: { type: "string" },
    phone: { type: "string" },
  },
});

if (!values.id || !values.name) {
  console.error('Usage: npm run create-user -- --id FR-0001 --name "Your Name" [--email …] [--role founder|sales_head|sales_rep|legion] [--title …]');
  process.exit(1);
}
if (!["founder", "sales_head", "sales_rep", "legion"].includes(values.role!)) {
  console.error("--role must be founder, sales_head, sales_rep or legion");
  process.exit(1);
}

await connect();
await migrate();
const pw = temporaryPassword();
const row = await db.maybe(
  `insert into crm_users (employee_code, full_name, email, phone, role, title, password_hash, must_change_password, source)
   values (upper($1), $2, $3, $4, $5, $6, $7, true, 'manual')
   on conflict (employee_code) do nothing returning employee_code`,
  [values.id, values.name, values.email ?? null, values.phone ?? null, values.role, values.title ?? null, await hashPassword(pw)],
);
if (!row) {
  console.error(`${values.id} already exists — reset their password from People & Access instead.`);
} else {
  console.log(`\nCreated ${values.role} ${row.employee_code} (${values.name}).`);
  console.log(`Temporary password (shown once): ${pw}`);
  console.log("They'll choose their own password at first sign-in.\n");
}
await db.close();
