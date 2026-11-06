import { PublicHeader } from "@/components/layout/public-header";
import { BrandLogo } from "@/components/layout/brand-logo";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PublicHeader />
      <main className="w-full min-w-0 flex-1">{children}</main>
      <footer className="border-t border-black/[0.06] bg-card py-12">
        <div className="mx-auto max-w-[90rem] px-6 md:px-10">
          <div className="flex flex-col gap-8 md:flex-row md:justify-between">
            <div>
              <BrandLogo variant="footer" />
              <p className="mt-3 text-sm text-muted-foreground">
                Intelligence-first redressal — Grievance Redressal &amp; Assistance System
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                © 2026 GRAAS Civic-Tech. Built for a safer digital India.
              </p>
            </div>
            <div className="flex gap-12 text-sm text-muted-foreground">
              <div className="space-y-2">
                <p className="font-medium text-foreground">Platform</p>
                <p className="hover:text-foreground cursor-pointer transition-colors">File Complaint</p>
                <p className="hover:text-foreground cursor-pointer transition-colors">Track Case</p>
                <p className="hover:text-foreground cursor-pointer transition-colors">Categories</p>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground">Support</p>
                <p className="hover:text-foreground cursor-pointer transition-colors">Help Center</p>
                <p className="hover:text-foreground cursor-pointer transition-colors">Legal Aid</p>
                <p className="hover:text-foreground cursor-pointer transition-colors">Counseling</p>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-foreground">Legal</p>
                <p className="hover:text-foreground cursor-pointer transition-colors">Privacy Policy</p>
                <p className="hover:text-foreground cursor-pointer transition-colors">Terms of Service</p>
                <p className="hover:text-foreground cursor-pointer transition-colors">Data Protection</p>
              </div>
            </div>
          </div>
          <div className="mt-8 border-t border-black/[0.06] pt-8 text-xs text-muted-foreground">
            Legal · Privacy · Contact support · API documentation
          </div>
        </div>
      </footer>
    </>
  );
}
