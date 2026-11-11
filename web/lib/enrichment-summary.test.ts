import test from "node:test";
import assert from "node:assert/strict";
import { describeEnrichment } from "./osint-utils";

test("public tool results summarize the hits an analyst needs", () => {
  const crawl = describeEnrichment("crawl_site", {
    seedHost: "phish.example",
    emails: ["ops@phish.example"],
    socialLinks: ["https://t.me/fraudster_91"],
    files: [],
  });
  assert.equal(crawl.label, "Site crawl");
  assert.match(crawl.summary, /ops@phish.example/);
  assert.match(crawl.summary, /1 emails/);

  const user = describeEnrichment("search_username", {
    username: "fraudster_91",
    likelyProfiles: ["https://github.com/fraudster_91"],
  });
  assert.match(user.summary, /1 profiles/);
  assert.match(user.summary, /github.com\/fraudster_91/);
});
