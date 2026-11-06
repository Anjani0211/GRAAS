import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateIpAddress, isSsrfTarget } from "../utils/httpClient";

test("isPrivateIpAddress blocks RFC1918 and loopback", () => {
  assert.equal(isPrivateIpAddress("127.0.0.1"), true);
  assert.equal(isPrivateIpAddress("10.0.0.5"), true);
  assert.equal(isPrivateIpAddress("192.168.1.1"), true);
  assert.equal(isPrivateIpAddress("172.16.0.1"), true);
  assert.equal(isPrivateIpAddress("169.254.169.254"), true);
  assert.equal(isPrivateIpAddress("8.8.8.8"), false);
  assert.equal(isPrivateIpAddress("::1"), true);
});

test("isSsrfTarget blocks localhost and link-local hostnames", () => {
  assert.equal(isSsrfTarget("http://127.0.0.1/admin"), true);
  assert.equal(isSsrfTarget("http://localhost:8000/"), true);
  assert.equal(isSsrfTarget("http://169.254.169.254/latest/meta-data"), true);
  assert.equal(isSsrfTarget("https://example.com/path"), false);
});
