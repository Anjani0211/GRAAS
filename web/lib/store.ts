import { create } from "zustand";
import type { User } from "./types";
import { authApi } from "./api";

interface SidebarStore {
  collapsed: boolean;
  mobileOpen: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setMobileOpen: (open: boolean) => void;
  toggleMobile: () => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  collapsed: false,
  mobileOpen: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
  setCollapsed: (collapsed) => set({ collapsed }),
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
  toggleMobile: () => set((s) => ({ mobileOpen: !s.mobileOpen })),
}));

interface SubmissionStore {
  currentStep: number;
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
}

export const useSubmissionStore = create<SubmissionStore>((set) => ({
  currentStep: 0,
  setStep: (step) => set({ currentStep: step }),
  nextStep: () => set((s) => ({ currentStep: Math.min(s.currentStep + 1, 4) })),
  prevStep: () => set((s) => ({ currentStep: Math.max(s.currentStep - 1, 0) })),
}));

interface AuthStore {
  user: User | null;
  /** Deprecated: kept null — auth uses httpOnly cookie only. */
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; phone?: string; role?: string }) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

function clearLegacyToken(): void {
  try {
    localStorage.removeItem("graas_token");
  } catch {
    /* SSR / private mode */
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (email, password) => {
    const { user } = await authApi.login(email, password);
    clearLegacyToken();
    set({ user, token: null, isAuthenticated: true });
  },

  register: async (data) => {
    const { user } = await authApi.register(data);
    clearLegacyToken();
    set({ user, token: null, isAuthenticated: true });
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      /* non-fatal */
    }
    clearLegacyToken();
    set({ user: null, token: null, isAuthenticated: false });
  },

  hydrate: async () => {
    clearLegacyToken();
    try {
      const { user } = await authApi.me();
      set({ user, token: null, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
