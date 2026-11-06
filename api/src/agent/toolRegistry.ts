import { z } from "zod";
import type { ConfidenceScore } from "../types/confidence";

export interface ToolContext {
  caseId: string;
  runId: string;
  callId: string;
  iterNum: number;
}

export interface ToolCallResult<T> {
  success: boolean;
  data?: T;
  rawText: string;
  confidence: ConfidenceScore;
  error?: string;
  screenshotPath?: string;
}

export interface AgentTool<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  execute: (input: TInput, ctx: ToolContext) => Promise<ToolCallResult<TOutput>>;
  shouldScreenshot: boolean;
  tier: "API" | "DOCKER" | "INTERNAL";
  requiresKey: string | null;
}

export function isToolAvailable(tool: AgentTool<unknown, unknown>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!tool.requiresKey) return true;
  return Boolean(env[tool.requiresKey]);
}
