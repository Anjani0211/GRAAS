import test from "node:test";
import assert from "node:assert/strict";
import { classifyProfileResponse, profileUrl, USERNAME_SITES } from "../services/osint/public/usernameSites";
import { extractFromHtml } from "../services/osint/public/pageExtract";
import { parseCertificateNames } from "../services/osint/public/certTransparency";
import { emailLocalPart, gravatarHash } from "../services/osint/public/emailFootprint";
import { extractPdfInfo } from "../utils/pdfMeta";
import { crawlSiteTool, harvestDomainTool } from "../agent/tools/reconTools";
import { selectToolPlans } from "../agent/textOnlyInvestigation";
import { extractEntitiesFromCorpus } from "../services/osintPipeline";

const ctx = { caseId: "CASE-1", runId: "RUN-1", callId: "CALL-1", iterNum: 1 };

test("username profile classification uses status and not-found markers", () => {
  const steam = USERNAME_SITES.find((s) => s.name === "Steam");
  const github = USERNAME_SITES.find((s) => s.name === "GitHub");
  assert.ok(steam && github);
  assert.equal(classifyProfileResponse(github, 404, ""), "missing");
  assert.equal(classifyProfileResponse(github, 200, "<html>octocat</html>"), "found");
  assert.equal(classifyProfileResponse(github, 403, "blocked"), "unknown");
  assert.equal(
    classifyProfileResponse(steam, 200, "The specified profile could not be found."),
    "missing",
  );
  assert.equal(profileUrl(github, "ada lovelace".replace(" ", "")), "https://github.com/adalovelace");
  assert.equal(profileUrl({ name: "X", urlTemplate: "https://example.com/{username}" }, "a b"), "https://example.com/a%20b");
});

test("page extract pulls emails, social links, files, and subdomains", () => {
  const html = `
    <a href="mailto:skip@phish.example">mail</a>
    <a href="/about">about</a>
    <a href="https://cdn.phish.example/app.apk">apk</a>
    <a href="https://github.com/suspect">gh</a>
    <a href="https://other.example/note.pdf">pdf</a>
    <img src="sprite@2x.png">
    contact ops@phish.example
  `;
  const extracted = extractFromHtml(html, "https://phish.example/index.html");
  assert.deepEqual(extracted.emails, ["skip@phish.example", "ops@phish.example"]);
  assert.ok(extracted.socialLinks.some((u) => u.includes("github.com/suspect")));
  assert.ok(extracted.files.some((u) => u.endsWith("app.apk")));
  assert.ok(extracted.files.some((u) => u.endsWith("note.pdf")));
  assert.deepEqual(extracted.subdomains, ["cdn.phish.example"]);
  assert.ok(extracted.internalLinks.some((u) => u.endsWith("/about")));
});

test("certificate name parser keeps only the apex and its hosts", () => {
  const hosts = parseCertificateNames(
    [
      { name_value: "*.phish.example\nmail.phish.example" },
      { name_value: "unrelated.example" },
      { name_value: "phish.example" },
    ],
    "phish.example",
  );
  assert.deepEqual(hosts.sort(), ["mail.phish.example", "phish.example"].sort());
});

test("email local-part and gravatar hash are normalized", () => {
  assert.equal(emailLocalPart("Ada.Lovelace@gmail.com"), "Ada.Lovelace");
  assert.equal(emailLocalPart("a@gmail.com"), null);
  assert.equal(gravatarHash(" User@Example.com "), gravatarHash("user@example.com"));
  assert.equal(gravatarHash("user@example.com"), "b58996c504c5638798eb6b511e6f49af");
});

test("pdf info dictionary reads author and creator", () => {
  const sample = Buffer.from("1 0 obj << /Author (Ada Lovelace) /Creator (GRAAS Test) /CreationDate (D:20200101) >>", "latin1");
  const info = extractPdfInfo(sample);
  assert.equal(info.Author, "Ada Lovelace");
  assert.equal(info.Creator, "GRAAS Test");
  assert.equal(info.CreationDate, "D:20200101");
});

test("text investigation plans the public footprint tools", () => {
  const plans = selectToolPlans([
    { type: "url", value: "https://phish.example/login" },
    { type: "domain", value: "phish.example" },
    { type: "email", value: "ops@phish.example" },
    { type: "username", value: "fraudster_91" },
    { type: "telegram", value: "@fraudster_91" },
  ]);
  const names = plans.map((p) => `${p.type}:${p.toolName}`);
  assert.ok(names.includes("url:scan_url"));
  assert.ok(names.includes("url:crawl_site"));
  assert.ok(names.includes("domain:harvest_domain"));
  assert.ok(names.includes("email:email_footprint"));
  assert.ok(names.includes("username:search_username"));
  assert.equal(plans.filter((p) => p.toolName === "search_username").length, 1);

  const many = selectToolPlans(
    Array.from({ length: 8 }, (_, i) => ({ type: "url", value: `https://phish${i}.example/` })),
  );
  assert.equal(many.filter((p) => p.toolName === "crawl_site").length, 5);
  assert.equal(many.filter((p) => p.toolName === "scan_url").length, 8);
});

test("labeled handles become username entities", () => {
  const entities = extractEntitiesFromCorpus([
    {
      text: "Suspect handle: fraudster_91 emailed ops@phish.example from https://phish.example/pay",
      sourceFile: "complaint.txt",
    },
  ]);
  assert.ok(entities.some((e) => e.type === "username" && e.value === "fraudster_91"));
  assert.ok(entities.some((e) => e.type === "email"));
  assert.ok(entities.some((e) => e.type === "url"));
});

test("crawl_site and harvest_domain reject private targets", async () => {
  const crawl = await crawlSiteTool.execute({ url: "http://127.0.0.1/admin" }, ctx);
  assert.equal(crawl.success, false);
  assert.equal(crawl.error, "BLOCKED_HOST");

  const harvest = await harvestDomainTool.execute({ domain: "not a domain" }, ctx);
  assert.equal(harvest.success, false);
  assert.equal(harvest.error, "INVALID_DOMAIN");
});
