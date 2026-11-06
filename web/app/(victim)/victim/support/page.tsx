"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Scale, Heart, Calendar, Video, Phone, Clock, Loader2 } from "lucide-react";
import { useSupportPartners, useMySupportBookings, useBookSupport } from "@/lib/queries";
import type { SupportPartner } from "@/lib/api";

export default function VictimSupportPage() {
  const { data: partnersData, isLoading: partnersLoading } = useSupportPartners();
  const { data: bookingsData } = useMySupportBookings();
  const book = useBookSupport();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const partners = partnersData?.partners ?? [];
  const lawyers = partners.filter((p) => p.supportType === "legal");
  const counselors = partners.filter((p) => p.supportType === "psychological");
  const bookings = bookingsData?.bookings ?? [];

  const requestBooking = async (
    partner: SupportPartner,
    contactPreference: "call" | "video" | "either" = "either",
  ) => {
    setMessage("");
    setBusyId(partner.id);
    try {
      await book.mutateAsync({
        supportType: partner.supportType,
        partnerId: partner.id,
        contactPreference,
      });
      setMessage(`Request sent to ${partner.name}. Status: requested.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-10">
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-muted/90 px-3 py-1 ring-1 ring-black/[0.06]">
          <span className="font-mono-technical text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Redressal support
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Support services</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Request legal or counselling support. Bookings are logged for GRAAS coordinators to confirm.
        </p>
        {message && (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {message}
          </p>
        )}
      </div>

      {bookings.length > 0 && (
        <Card className="border-black/[0.06]">
          <CardHeader>
            <CardTitle className="text-base">Your requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bookings.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{b.partnerName ?? b.advisorId}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {b.supportType} · {b.contactPreference ?? "either"}
                  </p>
                </div>
                <Badge variant="secondary" className="capitalize">
                  {b.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="h-full border-black/[0.06] stitch-glass">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Scale className="size-5" />
                </div>
                <div>
                  <CardTitle>Legal Support</CardTitle>
                  <CardDescription>Consult with cybercrime lawyers</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {partnersLoading && (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              )}
              {lawyers.map((lawyer) => (
                <div
                  key={lawyer.id}
                  className="flex items-center justify-between rounded-xl border border-border p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 text-sm font-bold">
                      {lawyer.name.split(" ").slice(1).map((n) => n[0]).join("")}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{lawyer.name}</p>
                      <p className="text-xs text-muted-foreground">{lawyer.specialization}</p>
                      <Badge variant={lawyer.available ? "success" : "secondary"} className="text-[10px] mt-1">
                        {lawyer.available ? "Available" : "Unavailable"}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!lawyer.available || busyId === lawyer.id || book.isPending}
                    className="gap-1.5"
                    onClick={() => void requestBooking(lawyer, "either")}
                  >
                    {busyId === lawyer.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Calendar className="size-3.5" />
                    )}
                    Book
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="h-full border-black/[0.06] stitch-glass">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
                  <Heart className="size-5" />
                </div>
                <div>
                  <CardTitle>Psychological Support</CardTitle>
                  <CardDescription>You are not alone. Our counselors are here for you.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl bg-rose-50/50 border border-rose-100 p-4 mb-6">
                <p className="text-sm text-rose-700 leading-relaxed">
                  Being a victim of cybercrime can be emotionally overwhelming. Our trained
                  counselors provide a safe, confidential space to help you process your
                  experience and build resilience.
                </p>
              </div>

              <div className="space-y-4">
                {counselors.map((counselor) => (
                  <div
                    key={counselor.id}
                    className="flex items-center justify-between rounded-xl border border-border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-full bg-rose-50 text-rose-500 text-sm font-bold">
                        {counselor.name.split(" ").slice(1).map((n) => n[0]).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{counselor.name}</p>
                        <p className="text-xs text-muted-foreground">{counselor.specialization}</p>
                        <Badge variant="success" className="text-[10px] mt-1">Available Now</Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={!counselor.available || busyId === counselor.id}
                        onClick={() => void requestBooking(counselor, "call")}
                      >
                        <Phone className="size-3.5" />
                        Call
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={!counselor.available || busyId === counselor.id}
                        onClick={() => void requestBooking(counselor, "video")}
                      >
                        <Video className="size-3.5" />
                        Video
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground rounded-lg bg-secondary p-3">
                <Clock className="size-4 shrink-0" />
                <span>Requests are reviewed by coordinators; urgent cases are prioritised.</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
