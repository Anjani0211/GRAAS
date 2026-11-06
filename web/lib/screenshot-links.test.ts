import test from "node:test";
import assert from "node:assert/strict";
import { resolveRefreshedScreenshotHref, screenshotHref } from "./screenshot-links";

test("resolveRefreshedScreenshotHref prefers fresh metadata", () => {
  const current = new Map<string, string>([["a1", "http://old/link"]]);
  const href = resolveRefreshedScreenshotHref(
    "a1",
    "http://api.local",
    [{ callId: "a1", toolName: "scan_url", timestamp: new Date().toISOString(), downloadPath: "/osint/x/new" }],
    current,
  );
  assert.equal(href, "http://api.local/osint/x/new");
});

test("resolveRefreshedScreenshotHref falls back to current map", () => {
  const current = new Map<string, string>([["a2", "http://current/link"]]);
  const href = resolveRefreshedScreenshotHref("a2", "http://api.local", [], current);
  assert.equal(href, "http://current/link");
});

test("screenshotHref combines base and path", () => {
  assert.equal(screenshotHref("http://api.local", "/osint/p/1"), "http://api.local/osint/p/1");
});

