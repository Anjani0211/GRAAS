import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Soft gate: redirects unauthenticated browser sessions away from protected
 * layouts. Full RBAC still enforced by AuthGuard + API JWT/cookie checks.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("graas_token")?.value;

  const isAdmin = pathname.startsWith("/admin");
  const isVictim = pathname.startsWith("/victim");

  if ((isAdmin || isVictim) && !token) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/victim/:path*"],
};
