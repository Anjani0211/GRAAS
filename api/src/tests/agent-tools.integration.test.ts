import test from "node:test";
import assert from "node:assert/strict";
import { captureWebsiteTool, extractApkIocsFromText, isBlockedHost, collectWebsiteCaptureData } from "../agent/tools/dockerTools";

test("capture_website rejects unsupported protocol", async () => {
  const res = await captureWebsiteTool.execute(
    { url: "ftp://example.com/file", reason: "protocol guard" },
    { caseId: "CASE-1", runId: "RUN-1", callId: "CALL-1", iterNum: 1 },
  );
  assert.equal(res.success, false);
  assert.equal(res.error, "UNSUPPORTED_PROTOCOL");
});

test("capture_website rejects localhost/private targets", async () => {
  const res = await captureWebsiteTool.execute(
    { url: "http://127.0.0.1/admin", reason: "ssrf guard" },
    { caseId: "CASE-1", runId: "RUN-1", callId: "CALL-2", iterNum: 1 },
  );
  assert.equal(res.success, false);
  assert.equal(res.error, "BLOCKED_HOST");
  assert.equal(isBlockedHost("192.168.1.44"), true);
});

test("analyze_apk IOC extraction shaping", () => {
  const sample = [
    "https://phish.example/login",
    "mail attacker@evil.in",
    "wallet 0x1234567890abcdef1234567890abcdef12345678",
    "C2 8.8.8.8",
    "UPI payme@okicici",
    "phone +919876543210",
  ].join("\n");
  const iocs = extractApkIocsFromText(sample);
  assert.ok(iocs.urls.includes("https://phish.example/login"));
  assert.ok(iocs.emails.includes("attacker@evil.in"));
  assert.ok(iocs.wallets.length >= 1);
  assert.ok(iocs.ips.includes("8.8.8.8"));
  assert.ok(iocs.phones.some((p) => p.includes("9876543210")));
});

test("capture_website success-path shaping is deterministic with fixture page harness", async () => {
  const payload = await collectWebsiteCaptureData(
    {
      title: async () => "Fixture Page",
      $$eval: async () => ["/a", "https://example.org/b"],
      $eval: async () => "hello world body text",
      screenshot: async () => "ZmFrZS1iYXNlNjQ=",
    },
    { url: "https://fixture.example", reason: "test" },
  );
  assert.ok(payload.rawText.includes("Captured https://fixture.example"));
  assert.equal(payload.data.title, "Fixture Page");
  assert.equal(payload.data.links.length, 2);
  assert.equal(payload.data.textSample, "hello world body text");
  assert.equal(payload.data.screenshotBase64, "ZmFrZS1iYXNlNjQ=");
});

