"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Mail, Lock, ArrowRight, Eye, EyeOff, User as UserIcon, Phone, Loader2 } from "lucide-react";
import { stitchFieldLabel } from "@/components/stitch/wizard-shell";
import { useAuthStore } from "@/lib/store";
import { ApiError } from "@/lib/api";
import type { User } from "@/lib/types";
import { isStaffRole } from "@/lib/roles";

type Mode = "login" | "register";
type Role = "victim" | "staff";

/** Open redirect-safe: only same-app relative paths, role-appropriate prefix. */
function postAuthDestination(user: User): string {
  if (typeof window === "undefined") {
    return user.role === "victim" ? "/victim/dashboard" : "/admin/dashboard";
  }
  const next = new URLSearchParams(window.location.search).get("next");
  if (next?.startsWith("/") && !next.startsWith("//")) {
    if (user.role === "victim" && next.startsWith("/victim/")) return next;
    if (isStaffRole(user.role) && next.startsWith("/admin/")) return next;
  }
  return user.role === "victim" ? "/victim/dashboard" : "/admin/dashboard";
}

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuthStore();

  const [mode, setMode] = useState<Mode>("login");
  const [role, setRole] = useState<Role>("victim");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        // Public self-register is always victim (API enforces this too).
        if (role === "staff") {
          setError("Staff accounts are created by an administrator only.");
          setIsSubmitting(false);
          return;
        }
        await register({ name, email, password, phone: phone || undefined, role: "victim" });
      }

      const user = useAuthStore.getState().user;
      if (user) {
        router.push(postAuthDestination(user));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-gradient-to-b from-background via-background to-muted/40 px-4 py-12 sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-[0.35] stitch-ambient" aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mx-auto w-full max-w-md"
      >
        <div className="mb-8 text-center">
          {/* <h1 className="text-2xl font-bold">
            {mode === "login" ? "Welcome back" : "Create an account"}
          </h1> */}
          <p className="mt-1 text-muted-foreground">
            {mode === "login"
              ? "Sign in to access your GRAAS account"
              : "Register to get started with GRAAS"}
          </p>
        </div>

        <div className="mb-6 flex rounded-xl border border-black/[0.06] bg-muted/50 p-1">
          <button
            onClick={() => setRole("victim")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all cursor-pointer ${
              role === "victim" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
            }`}
          >
            Victim / Citizen
          </button>
          <button
            onClick={() => setRole("staff")}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all cursor-pointer ${
              role === "staff" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
            }`}
          >
            Staff / Officer
          </button>
        </div>

        <Card className="stitch-glass stitch-ambient rounded-2xl border-black/[0.08] shadow-[0_12px_40px_rgba(26,86,219,0.08)]">
          <CardHeader>
            <CardTitle className="text-base">
              {mode === "login"
                ? role === "victim"
                  ? "Citizen Login"
                  : "Staff Login"
                : role === "victim"
                  ? "Citizen Registration"
                  : "Staff Registration"}
            </CardTitle>
            <CardDescription>
              {role === "victim"
                ? "Access your case dashboard and track complaints"
                : "Access the admin panel and case management tools"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {mode === "register" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name" className={stitchFieldLabel}>
                      Full name
                    </Label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="name"
                        type="text"
                        placeholder="John Doe"
                        className="pl-9"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone" className={stitchFieldLabel}>
                      Phone (optional)
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="+91 98765 43210"
                        className="pl-9"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className={stitchFieldLabel}>
                  Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    className="pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className={stitchFieldLabel}>
                    Password
                  </Label>
                  {mode === "login" && (
                    <Link href="#" className="text-xs text-primary hover:underline">
                      Forgot password?
                    </Link>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className="pl-9 pr-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <Button variant="cta" className="w-full" size="lg" type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {mode === "login" ? "Signing in..." : "Creating account..."}
                  </>
                ) : (
                  <>
                    {mode === "login" ? "Sign In" : "Create Account"}
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === "login" ? (
                <>
                  Don&apos;t have an account?{" "}
                  <button
                    onClick={() => { setMode("register"); setError(""); }}
                    className="text-primary hover:underline font-medium cursor-pointer"
                  >
                    Register
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    onClick={() => { setMode("login"); setError(""); }}
                    className="text-primary hover:underline font-medium cursor-pointer"
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>

            {role === "victim" && mode === "login" && (
              <p className="text-center text-sm text-muted-foreground mt-4">
                Need to file a complaint?{" "}
                <Link href="/submit" className="text-primary hover:underline font-medium">
                  Submit here
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
