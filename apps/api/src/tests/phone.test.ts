import assert from "node:assert/strict";
import { test } from "node:test";
import { emailKey, formatPhone, phoneKey } from "../lib/phone.js";

test("phone numbers in every shape normalise to one key", () => {
  for (const raw of ["9876543210", "+91 98765 43210", "+91-98765-43210", "098765 43210", "0091 9876543210", "(+91) 98765-43210"]) {
    assert.equal(phoneKey(raw), "919876543210", raw);
  }
  assert.equal(phoneKey("+1 415 555 0100"), "14155550100");
  assert.equal(phoneKey("12345"), null);
  assert.equal(phoneKey(""), null);
  assert.equal(formatPhone("919876543210"), "+91 98765 43210");
});

test("emails are lower-cased and validated", () => {
  assert.equal(emailKey("  Riya@FocusRealm.com "), "riya@focusrealm.com");
  assert.equal(emailKey("not-an-email"), null);
});
