import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import osintRouter from "../routes/osint";
import { Case } from "../models/Case";
import { InvestigationMemoryModel } from "../models/InvestigationMemory";
import { storageService } from "../services/storageService";

type CaseLike = {
  caseNumber: string;
  osintInvestigation?: { lastRunId?: string };
};

function withTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: "u-1", role: "osint_analyst" };
    next();
  });
  app.use("/osint", osintRouter);
  const server = app.listen(0);
  return server;
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test("GET agent-screenshots list returns mapped callId records", async () => {
  const oldFindById = (Case.findById as unknown);
  const oldFindOne = (Case.findOne as unknown);
  const oldMemFindOne = (InvestigationMemoryModel.findOne as unknown);
  try {
    (Case.findById as unknown as (id: string) => Promise<CaseLike | null>) = async (id) =>
      id === "507f1f77bcf86cd799439011"
        ? ({ caseNumber: "CASE-77", osintInvestigation: { lastRunId: "RUN-77" } } as CaseLike)
        : null;
    (InvestigationMemoryModel.findOne as unknown as () => { lean: () => Promise<unknown> }) = () => ({
      lean: async () => ({
        iterations: [
          { callId: "c-1", toolName: "scan_url", timestamp: new Date(), screenshotPath: "evidence/c-1.jpg" },
          { callId: "c-2", toolName: "lookup_ip", timestamp: new Date() },
        ],
      }),
    });

    const server = withTestApp();
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Unexpected server address");
      const { status, body } = await fetchJson(
        `http://127.0.0.1:${addr.port}/osint/case/507f1f77bcf86cd799439011/investigation/agent-screenshots`,
      );
      assert.equal(status, 200);
      const obj = body as { runId: string; screenshots: Array<{ callId: string; downloadPath: string }> };
      assert.equal(obj.runId, "RUN-77");
      assert.equal(obj.screenshots.length, 1);
      assert.equal(obj.screenshots[0]?.callId, "c-1");
      assert.ok(obj.screenshots[0]?.downloadPath.includes("/agent-screenshots/c-1/download"));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  } finally {
    (Case.findById as unknown) = oldFindById;
    (Case.findOne as unknown) = oldFindOne;
    (InvestigationMemoryModel.findOne as unknown) = oldMemFindOne;
  }
});

test("GET agent-screenshots download streams local bytes when storage is unavailable", async () => {
  const oldFindById = (Case.findById as unknown);
  const oldFindOne = (Case.findOne as unknown);
  const oldMemFindOne = (InvestigationMemoryModel.findOne as unknown);
  const oldIsAvailable = storageService.isAvailable.bind(storageService);
  const oldReadEvidence = storageService.readEvidence.bind(storageService);
  try {
    (Case.findById as unknown as (id: string) => Promise<CaseLike | null>) = async (id) =>
      id === "507f1f77bcf86cd799439012"
        ? ({ caseNumber: "CASE-88", osintInvestigation: { lastRunId: "RUN-88" } } as CaseLike)
        : null;
    (InvestigationMemoryModel.findOne as unknown as () => { lean: () => Promise<unknown> }) = () => ({
      lean: async () => ({
        iterations: [{ callId: "c-8", toolName: "capture_website", screenshotPath: "evidence/c-8.jpg" }],
      }),
    });
    (storageService.isAvailable as unknown as () => boolean) = () => false;
    (storageService.readEvidence as unknown as (p: string) => Promise<Buffer>) = async (p) => {
      assert.equal(p, "evidence/c-8.jpg");
      return Buffer.from("jpeg-bytes");
    };

    const server = withTestApp();
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Unexpected server address");
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/osint/case/507f1f77bcf86cd799439012/investigation/agent-screenshots/c-8/download`,
      );
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/jpeg");
      const text = await res.text();
      assert.equal(text, "jpeg-bytes");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  } finally {
    (Case.findById as unknown) = oldFindById;
    (Case.findOne as unknown) = oldFindOne;
    (InvestigationMemoryModel.findOne as unknown) = oldMemFindOne;
    (storageService.isAvailable as unknown as () => boolean) = oldIsAvailable;
    (storageService.readEvidence as unknown as (p: string) => Promise<Buffer>) = oldReadEvidence;
  }
});

test("GET agent-screenshots download redirects to presigned URL when storage is available", async () => {
  const oldFindById = (Case.findById as unknown);
  const oldFindOne = (Case.findOne as unknown);
  const oldMemFindOne = (InvestigationMemoryModel.findOne as unknown);
  const oldIsAvailable = storageService.isAvailable.bind(storageService);
  const oldGetPresigned = storageService.getPresignedUrl.bind(storageService);
  try {
    (Case.findById as unknown as (id: string) => Promise<CaseLike | null>) = async (id) =>
      id === "507f1f77bcf86cd799439013"
        ? ({ caseNumber: "CASE-99", osintInvestigation: { lastRunId: "RUN-99" } } as CaseLike)
        : null;
    (InvestigationMemoryModel.findOne as unknown as () => { lean: () => Promise<unknown> }) = () => ({
      lean: async () => ({
        iterations: [{ callId: "c-9", toolName: "capture_website", screenshotPath: "evidence/c-9.jpg" }],
      }),
    });
    (storageService.isAvailable as unknown as () => boolean) = () => true;
    (storageService.getPresignedUrl as unknown as (p: string) => Promise<string>) = async (p) => {
      assert.equal(p, "evidence/c-9.jpg");
      return "https://signed.example/object/c-9.jpg";
    };

    const server = withTestApp();
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Unexpected server address");
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/osint/case/507f1f77bcf86cd799439013/investigation/agent-screenshots/c-9/download`,
        { redirect: "manual" },
      );
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "https://signed.example/object/c-9.jpg");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  } finally {
    (Case.findById as unknown) = oldFindById;
    (Case.findOne as unknown) = oldFindOne;
    (InvestigationMemoryModel.findOne as unknown) = oldMemFindOne;
    (storageService.isAvailable as unknown as () => boolean) = oldIsAvailable;
    (storageService.getPresignedUrl as unknown as (p: string) => Promise<string>) = oldGetPresigned;
  }
});

