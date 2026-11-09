import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmailForLookup } from "../utils/authUtils";

test("normalizeEmailForLookup trims and lowercases login emails", () => {
  assert.equal(normalizeEmailForLookup(" Admin@GRASS.Local "), "admin@grass.local");
  assert.equal(normalizeEmailForLookup("ADMIN@GRASS.LOCAL"), "admin@grass.local");
});
