import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { casesApi, triageApi, escalationApi, notificationsApi, osintApi, authApi, supportApi } from "./api";
import type { CaseStatus } from "./utils";
import type { OsintPhase } from "./types";

export function useCases(
  params?: {
    status?: string;
    severity?: string;
    category?: string;
    q?: string;
    unassigned?: boolean;
    limit?: number;
  },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["cases", params],
    queryFn: () => casesApi.list(params),
    enabled: options?.enabled ?? true,
  });
}

export function useCase(id: string | undefined) {
  return useQuery({
    queryKey: ["case", id],
    queryFn: () => casesApi.getById(id!),
    enabled: !!id,
  });
}

export function useVictimCases() {
  return useQuery({
    queryKey: ["victimCases"],
    queryFn: () => casesApi.listMine(),
  });
}

export function useVictimCase(id: string | undefined) {
  return useQuery({
    queryKey: ["victimCase", id],
    queryFn: () => casesApi.getMineById(id!),
    enabled: !!id,
  });
}

export function useCaseStats() {
  return useQuery({
    queryKey: ["caseStats"],
    queryFn: () => casesApi.getStats(),
    refetchInterval: 30_000,
  });
}

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: casesApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["victimCases"] });
      qc.invalidateQueries({ queryKey: ["caseStats"] });
    },
  });
}

export function useUpdateCaseStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: CaseStatus; note?: string }) =>
      casesApi.updateStatus(id, status, note),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["case", vars.id] });
      qc.invalidateQueries({ queryKey: ["caseStats"] });
      qc.invalidateQueries({ queryKey: ["osintQueue"] });
      qc.invalidateQueries({ queryKey: ["osintInvestigation", vars.id] });
    },
  });
}

export function useAssignCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, officerId }: { id: string; officerId: string | null }) =>
      casesApi.assign(id, officerId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["case", vars.id] });
      qc.invalidateQueries({ queryKey: ["victimCase", vars.id] });
      qc.invalidateQueries({ queryKey: ["caseStats"] });
    },
  });
}

export function usePostCaseMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
      visibility,
    }: {
      id: string;
      body: string;
      visibility?: "internal" | "victim";
    }) => casesApi.postMessage(id, body, visibility),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["case", vars.id] });
      qc.invalidateQueries({ queryKey: ["victimCase", vars.id] });
    },
  });
}

export function useRequestErasure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => casesApi.requestErasure(caseId),
    onSuccess: (_data, caseId) => {
      qc.invalidateQueries({ queryKey: ["victimCase", caseId] });
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    },
  });
}

export function useUploadVictimEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, files }: { caseId: string; files: File[] }) =>
      casesApi.uploadEvidence(caseId, files),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["victimCase", vars.caseId] });
      qc.invalidateQueries({ queryKey: ["case", vars.caseId] });
    },
  });
}

export function useSupportPartners() {
  return useQuery({
    queryKey: ["supportPartners"],
    queryFn: () => supportApi.partners(),
  });
}

export function useMySupportBookings() {
  return useQuery({
    queryKey: ["supportBookingsMine"],
    queryFn: () => supportApi.myBookings(),
  });
}

export function useBookSupport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: supportApi.book,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supportBookingsMine"] });
    },
  });
}

export function useTeamUsers() {
  return useQuery({
    queryKey: ["teamUsers"],
    queryFn: () => authApi.listUsers(),
  });
}

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      email: string;
      password: string;
      phone?: string;
      badgeId?: string;
      role: string;
    }) => authApi.createStaff(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teamUsers"] });
    },
  });
}

export function useTriage() {
  return useMutation({
    mutationFn: ({
      text,
      monetaryLoss,
      complainantIsMinor,
      involvesMinor,
    }: {
      text: string;
      monetaryLoss?: number;
      complainantIsMinor?: boolean;
      involvesMinor?: boolean;
    }) => triageApi.classify(text, monetaryLoss, { complainantIsMinor, involvesMinor }),
  });
}

export function useOsintQueue() {
  return useQuery({
    queryKey: ["osintQueue"],
    queryFn: () => osintApi.queue(),
  });
}

export function useOsintInvestigation(caseId: string | undefined) {
  return useQuery({
    queryKey: ["osintInvestigation", caseId],
    queryFn: () => osintApi.getInvestigation(caseId!),
    enabled: !!caseId,
  });
}

export function useOsintAddEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      vars:
        | { caseId: string; file: File }
        | { caseId: string; fileName: string; fileType?: string; ocrText?: string; analystNotes?: string },
    ) => {
      if ("file" in vars) {
        return osintApi.addEvidenceFile(vars.caseId, vars.file);
      }
      const { caseId, fileName, fileType, ocrText, analystNotes } = vars;
      return osintApi.addEvidence(caseId, { fileName, fileType, ocrText, analystNotes });
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["osintInvestigation", v.caseId] });
      qc.invalidateQueries({ queryKey: ["case", v.caseId] });
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["osintQueue"] });
    },
  });
}

export function useOsintPatchEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      caseId,
      evidenceId,
      ...body
    }: { caseId: string; evidenceId: string; ocrText?: string; analystNotes?: string }) =>
      osintApi.patchEvidence(caseId, evidenceId, body),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["osintInvestigation", v.caseId] });
      qc.invalidateQueries({ queryKey: ["case", v.caseId] });
    },
  });
}

export function useOsintDeleteEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, evidenceId }: { caseId: string; evidenceId: string }) =>
      osintApi.deleteEvidence(caseId, evidenceId),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["osintInvestigation", v.caseId] });
    },
  });
}

export function useOsintPatchDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      caseId,
      ...body
    }: { caseId: string; draftReport?: string; finalReport?: string; phase?: OsintPhase }) =>
      osintApi.patchDraft(caseId, body),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["osintInvestigation", v.caseId] });
    },
  });
}

export function useOsintFinalize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, finalReport }: { caseId: string; finalReport?: string }) =>
      osintApi.finalizeReport(caseId, { finalReport }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["osintInvestigation", v.caseId] });
      qc.invalidateQueries({ queryKey: ["case", v.caseId] });
    },
  });
}

export function useOsintRunTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      caseId,
      ...body
    }: {
      caseId: string;
      kind: "whois" | "ip" | "urlscan" | "shodan";
      query: string;
      attach?: boolean;
    }) => osintApi.runTool(caseId, body),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["osintInvestigation", v.caseId] });
    },
  });
}

export function useOsintDeleteTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, toolId }: { caseId: string; toolId: string }) =>
      osintApi.deleteTool(caseId, toolId),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["osintInvestigation", v.caseId] });
    },
  });
}

export function useOsintSubmitLe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      caseId: string;
      leAgency: string;
      leDistrict?: string;
      leReferenceNumber?: string;
      advanceCaseStatus?: boolean;
    }) => osintApi.submitToLe(args.caseId, args),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["osintInvestigation", v.caseId] });
      qc.invalidateQueries({ queryKey: ["case", v.caseId] });
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["osintQueue"] });
      qc.invalidateQueries({ queryKey: ["caseStats"] });
    },
  });
}

export function useEscalate() {
  return useMutation({
    mutationFn: escalationApi.create,
  });
}

// ── Dispatch (entity routing) ───────────────────────────────────────────
export function useDispatchPlan(caseId: string | undefined) {
  return useQuery({
    queryKey: ["dispatchPlan", caseId],
    queryFn: () => osintApi.getDispatch(caseId!),
    enabled: !!caseId,
  });
}

export function useGenerateDispatchPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, regenerate }: { caseId: string; regenerate?: boolean }) =>
      osintApi.planDispatch(caseId, { regenerate }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["dispatchPlan", v.caseId] });
    },
  });
}

export function usePatchDispatchRecipient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      caseId,
      dispatchId,
      recipientId,
      ...body
    }: {
      caseId: string;
      dispatchId: string;
      recipientId: string;
      status?: import("./types").DispatchRecipientStatus;
      statusNote?: string;
      confirmationRef?: string;
      contactEmail?: string;
      contactPortal?: string;
    }) => osintApi.patchDispatchRecipient(caseId, dispatchId, recipientId, body),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["dispatchPlan", v.caseId] });
      qc.invalidateQueries({ queryKey: ["osintInvestigation", v.caseId] });
      qc.invalidateQueries({ queryKey: ["case", v.caseId] });
      qc.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}

export function useEscalationTemplates() {
  return useQuery({
    queryKey: ["escalationTemplates"],
    queryFn: () => escalationApi.getTemplates(),
  });
}

export function useSendNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.send,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificationFeed"] });
    },
  });
}

export function useNotificationHistory(caseId: string | undefined) {
  return useQuery({
    queryKey: ["notifications", caseId],
    queryFn: () => notificationsApi.history(caseId!),
    enabled: !!caseId,
  });
}

export function useNotificationFeed() {
  return useQuery({
    queryKey: ["notificationFeed"],
    queryFn: () => notificationsApi.recent(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
