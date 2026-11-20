"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AdminHeader } from "@/components/layout/admin-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { threatGraphApi } from "@/lib/api";
import type {
  ThreatGraphSlice,
  ThreatGraphNode,
  ThreatEntityRow,
  OsintEntityType,
  OsintConfidence,
} from "@/lib/types";
import {
  Loader2,
  Network,
  RotateCw,
  Filter,
  AlertTriangle,
  ChevronRight,
  Crosshair,
  Hash,
} from "lucide-react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type FgNode = ThreatGraphNode & { x?: number; y?: number; __indexColor?: string };

function shortLabel(n: ThreatGraphNode): string {
  const raw = (n.label || n.id || "").trim();
  if (n.type === "Case") return raw.length > 18 ? raw.slice(0, 16) + "…" : raw;
  const kind = n.entityType ? n.entityType.toUpperCase() : "ENT";
  const val = raw.length > 22 ? raw.slice(0, 20) + "…" : raw;
  return `${kind} · ${val}`;
}

function nodeRadius(n: ThreatGraphNode): number {
  if (n.type === "Case") return 10;
  const risk = n.riskScore ?? 20;
  return Math.max(6, Math.min(14, 5 + risk / 12));
}

const ENTITY_TYPES: { id: OsintEntityType; label: string; tone: string }[] = [
  { id: "upi",      label: "UPI",      tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { id: "phone",    label: "Phone",    tone: "bg-blue-100 text-blue-800 border-blue-300" },
  { id: "email",    label: "Email",    tone: "bg-sky-100 text-sky-800 border-sky-300" },
  { id: "url",      label: "URL",      tone: "bg-violet-100 text-violet-800 border-violet-300" },
  { id: "domain",   label: "Domain",   tone: "bg-purple-100 text-purple-800 border-purple-300" },
  { id: "ipv4",     label: "IPv4",     tone: "bg-slate-200 text-slate-800 border-slate-300" },
  { id: "wallet",   label: "Wallet",   tone: "bg-orange-100 text-orange-800 border-orange-300" },
  { id: "telegram", label: "Telegram", tone: "bg-cyan-100 text-cyan-800 border-cyan-300" },
  { id: "username", label: "Username", tone: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300" },
];

const CONFIDENCE_OPTIONS: OsintConfidence[] = ["UNVERIFIED", "LOW", "MEDIUM", "HIGH", "VERIFIED"];

const NODE_COLORS: Record<string, string> = {
  Case:     "#0ea5e9",
  upi:      "#10b981",
  phone:    "#3b82f6",
  email:    "#0284c7",
  url:      "#8b5cf6",
  domain:   "#a855f7",
  ipv4:     "#64748b",
  wallet:   "#f97316",
  telegram: "#06b6d4",
  username: "#d946ef",
};

function colorForNode(n: ThreatGraphNode): string {
  if (n.type === "Case") return NODE_COLORS.Case;
  return NODE_COLORS[n.entityType ?? "ipv4"] ?? "#94a3b8";
}

function formatINR(n: number | undefined): string {
  if (!n) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function RiskBar({ score }: { score: number }) {
  const cls =
    score >= 80 ? "bg-red-500" :
    score >= 60 ? "bg-amber-500" :
    score >= 40 ? "bg-yellow-400" :
                  "bg-emerald-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-secondary">
      <div className={cn("h-full rounded-full", cls)} style={{ width: Math.min(100, score) + "%" }} />
    </div>
  );
}

export default function ThreatGraphPage() {
  const [selectedTypes, setSelectedTypes] = useState<OsintEntityType[]>(["upi", "phone", "domain", "wallet"]);
  const [minCaseCount, setMinCaseCount] = useState(1);
  const [minConfidence, setMinConfidence] = useState<OsintConfidence>("UNVERIFIED");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [nodeLimit, setNodeLimit] = useState(150);
  const [focusedEntity, setFocusedEntity] = useState<{ type: OsintEntityType; value: string } | null>(null);
  const [selectedNode, setSelectedNode] = useState<ThreatGraphNode | null>(null);
  const graphBoxRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<{ zoomToFit?: (ms?: number, padding?: number) => void } | null>(null);
  const [graphWidth, setGraphWidth] = useState(720);

  useEffect(() => {
    const el = graphBoxRef.current;
    if (!el) return;
    const measure = () => setGraphWidth(Math.max(320, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitGraph = useCallback(() => {
    // Simulation + label paint need a beat before fit, or clusters clip off-canvas.
    window.setTimeout(() => fgRef.current?.zoomToFit?.(400, 72), 120);
    window.setTimeout(() => fgRef.current?.zoomToFit?.(350, 80), 700);
  }, []);

  const paintNode = useCallback((node: FgNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const r = nodeRadius(node);
    const color = colorForNode(node);
    const selected = selectedNode?.id === node.id;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.fill();
    if (selected) {
      ctx.lineWidth = 2.5 / globalScale;
      ctx.strokeStyle = "#0f172a";
      ctx.stroke();
    } else if (node.type === "Case") {
      ctx.lineWidth = 1.5 / globalScale;
      ctx.strokeStyle = "#0369a1";
      ctx.stroke();
    }

    const label = shortLabel(node);
    // Keep label ~11px on screen regardless of zoom.
    const fontSize = 11 / Math.max(globalScale, 0.35);
    ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const padX = 3 / globalScale;
    const padY = 1.5 / globalScale;
    const textW = ctx.measureText(label).width;
    const boxY = y + r + 2 / globalScale;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(x - textW / 2 - padX, boxY, textW + padX * 2, fontSize + padY * 2);
    ctx.fillStyle = "#0f172a";
    ctx.fillText(label, x, boxY + padY);
  }, [selectedNode?.id]);

  const paintPointer = useCallback((node: FgNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node) + 2, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.fill();
  }, []);

  const filterParams = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      entityTypes: selectedTypes,
      minCaseCount,
      minConfidence,
      nodeLimit,
    }),
    [from, to, selectedTypes, minCaseCount, minConfidence, nodeLimit],
  );

  const globalQ = useQuery<ThreatGraphSlice>({
    queryKey: ["threatGraph", "global", filterParams],
    queryFn: () => threatGraphApi.global(filterParams),
    enabled: !focusedEntity,
  });

  const entityQ = useQuery<ThreatGraphSlice>({
    queryKey: ["threatGraph", "entity", focusedEntity?.type, focusedEntity?.value, nodeLimit],
    queryFn: () =>
      threatGraphApi.entity(focusedEntity!.type, focusedEntity!.value, { nodeLimit }),
    enabled: !!focusedEntity,
  });

  const slice = focusedEntity ? entityQ.data : globalQ.data;
  const isLoading = focusedEntity ? entityQ.isLoading : globalQ.isLoading;
  const isError = focusedEntity ? entityQ.isError : globalQ.isError;

  useEffect(() => {
    if (!slice?.nodes?.length) return;
    fitGraph();
  }, [slice?.nodes?.length, slice?.links?.length, graphWidth, focusedEntity, fitGraph]);

  const toggleType = (t: OsintEntityType) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  const onPickRow = (row: ThreatEntityRow) => {
    setFocusedEntity({ type: row.type, value: row.value });
    setSelectedNode(null);
  };

  const onPickNode = (node: unknown) => {
    const n = node as ThreatGraphNode;
    setSelectedNode(n);
    if (n.type === "Entity" && n.entityType) {
      setFocusedEntity({ type: n.entityType, value: n.label });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AdminHeader title="Threat Intelligence Graph" />
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Network className="size-6 text-primary" />
              Threat Intelligence Graph
            </h1>
            <p className="text-sm text-muted-foreground">
              Cross-case OSINT pivot — top threats, shared infrastructure, and entity-centric exploration.
            </p>
          </div>
          {focusedEntity ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFocusedEntity(null);
                setSelectedNode(null);
              }}
            >
              <Crosshair className="mr-1 size-3.5" />
              Back to global view
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => globalQ.refetch()}
              disabled={globalQ.isFetching}
            >
              {globalQ.isFetching ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <RotateCw className="mr-1 size-3.5" />
              )}
              Refresh
            </Button>
          )}
        </div>

        {/* Focus banner */}
        {focusedEntity && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">Focused on </span>
            <span className="font-mono font-semibold">
              {focusedEntity.type}:{focusedEntity.value}
            </span>
            {entityQ.data && (
              <span className="ml-2 text-xs text-muted-foreground">
                · {entityQ.data.stats.totalCases} linked case(s) ·{" "}
                {entityQ.data.stats.totalEntities} co-occurring indicator(s)
              </span>
            )}
          </div>
        )}

        {/* Filters */}
        {!focusedEntity && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Filter className="size-4" />
                Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">From</Label>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">To</Label>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Min cases</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={minCaseCount}
                    onChange={(e) => setMinCaseCount(Math.max(1, Number(e.target.value) || 1))}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Min confidence</Label>
                  <select
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(e.target.value as OsintConfidence)}
                    className="flex h-8 w-full rounded-md border border-input bg-card px-2 text-sm"
                  >
                    {CONFIDENCE_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Node limit</Label>
                  <Input
                    type="number"
                    min={10}
                    max={1000}
                    step={10}
                    value={nodeLimit}
                    onChange={(e) => setNodeLimit(Math.max(10, Number(e.target.value) || 50))}
                    className="h-8"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ENTITY_TYPES.map((t) => {
                  const active = selectedTypes.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleType(t.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                        active ? t.tone : "border-border bg-secondary text-muted-foreground",
                      )}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats strip */}
        {slice && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Entities" value={slice.stats.totalEntities} />
            <StatCard label="Cases linked" value={slice.stats.totalCases} />
            <StatCard label="Edges" value={slice.stats.totalEdges} />
            <StatCard label="High-risk" value={slice.stats.highRiskEntities} tone="red" />
          </div>
        )}

        {/* Main: graph + ranked panel */}
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold">
                {focusedEntity ? "Entity pivot" : "Global graph"}
              </CardTitle>
              {selectedNode && (
                <Badge variant="outline" className="text-[11px]">
                  selected: {selectedNode.label}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              <div
                ref={graphBoxRef}
                className="relative h-[520px] overflow-hidden rounded-xl border border-border bg-[#f8fafc]"
              >
                {isLoading && (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" /> Building threat graph…
                  </div>
                )}
                {isError && (
                  <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-sm text-destructive">
                    <span>Failed to load graph.</span>
                    <span className="text-xs text-muted-foreground">
                      {(focusedEntity ? entityQ.error : globalQ.error) instanceof Error
                        ? (focusedEntity ? entityQ.error : globalQ.error)!.message
                        : "Check date filters or sign in again."}
                    </span>
                  </div>
                )}
                {slice && !isLoading && slice.nodes.length === 0 && (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    No nodes for these filters. Lower min cases / confidence or enable more entity types.
                  </div>
                )}
                {slice && !isLoading && slice.nodes.length > 0 && (
                  <ForceGraph2D
                    ref={fgRef as never}
                    graphData={{
                      nodes: slice.nodes.map((n) => ({ ...n })),
                      links: slice.links.map((l) => ({ ...l })),
                    }}
                    width={graphWidth}
                    height={520}
                    backgroundColor="#f8fafc"
                    nodeId="id"
                    nodeLabel={(n: unknown) => {
                      const node = n as ThreatGraphNode;
                      const bits = [node.label];
                      if (node.entityType) bits.push(node.entityType);
                      if (node.caseCount != null) bits.push(`${node.caseCount} case(s)`);
                      if (node.riskScore != null) bits.push(`risk ${node.riskScore}`);
                      return bits.join(" · ");
                    }}
                    nodeCanvasObject={(node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) =>
                      paintNode(node as FgNode, ctx, globalScale)
                    }
                    nodePointerAreaPaint={(node: unknown, color: string, ctx: CanvasRenderingContext2D) =>
                      paintPointer(node as FgNode, color, ctx)
                    }
                    linkColor={(l: unknown) => {
                      const rel = (l as { relationship?: string }).relationship;
                      return rel === "CO_OCCURS" ? "rgba(219,39,119,0.55)" : "rgba(71,85,105,0.55)";
                    }}
                    linkWidth={(l: unknown) => {
                      const w = (l as { weight?: number }).weight ?? 0.5;
                      return Math.max(1.2, w * 2.4);
                    }}
                    linkDirectionalParticles={1}
                    linkDirectionalParticleWidth={2}
                    cooldownTicks={90}
                    d3VelocityDecay={0.28}
                    onEngineStop={fitGraph}
                    onNodeClick={onPickNode}
                  />
                )}
                {slice && slice.nodes.length > 0 && (
                  <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-[10px] text-slate-600 shadow-sm ring-1 ring-slate-200">
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-full bg-sky-500" /> Case
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-full bg-blue-500" /> Phone
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-full bg-purple-500" /> Domain
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-full bg-emerald-500" /> UPI
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Labels show on every node. Click a node to pivot; pink edges are co-occurrence in pivot view.
              </p>
            </CardContent>
          </Card>

          <Card className="self-start">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 text-amber-600" />
                Top threats
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[520px] space-y-2 overflow-auto p-2">
              {slice?.topThreats.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">No entities match the current filters.</p>
              )}
              {slice?.topThreats.map((row) => (
                <ThreatRow key={row.type + ":" + row.value} row={row} onPick={onPickRow} />
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Selected case panel */}
        {selectedNode?.type === "Case" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Selected case</CardTitle>
            </CardHeader>
            <CardContent>
              <Link
                href={"/admin/osint/case/" + encodeURIComponent(selectedNode.label)}
                className="text-sm font-mono text-primary underline-offset-2 hover:underline"
              >
                Open {selectedNode.label} workspace
                <ChevronRight className="ml-1 inline size-3.5" />
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "red" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "mt-1 text-2xl font-semibold",
            tone === "red" && value > 0 ? "text-red-600" : "",
          )}
        >
          {value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

function ThreatRow({
  row,
  onPick,
}: {
  row: ThreatEntityRow;
  onPick: (row: ThreatEntityRow) => void;
}) {
  const meta = ENTITY_TYPES.find((t) => t.id === row.type);
  return (
    <button
      onClick={() => onPick(row)}
      className="block w-full rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:bg-secondary/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={cn("text-[10px]", meta?.tone)}>
              {meta?.label ?? row.type}
            </Badge>
            <Badge className="bg-slate-200 text-slate-800 text-[10px]">{row.bestConfidence}</Badge>
            <span className="font-mono text-xs">{row.value}</span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {row.touches.length} case(s) · {formatINR(row.totalLossInr)} disputed
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="flex items-center gap-1 text-xs font-semibold">
            <Hash className="size-3" />
            {row.riskScore}
          </p>
        </div>
      </div>
      <div className="mt-2">
        <RiskBar score={row.riskScore} />
      </div>
    </button>
  );
}
