import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clock, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getAccess, type AccessState } from "@/lib/access";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pending")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Onay Bekleniyor | Parselasyon Optimizasyon" },
      { name: "description", content: "Hesabınız yönetici onayını bekliyor." },
      { property: "og:title", content: "Onay Bekleniyor" },
      { property: "og:description", content: "Hesabınız yönetici onayını bekliyor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Pending,
});

function Pending() {
  const navigate = useNavigate();
  const [a, setA] = useState<AccessState | null>(null);

  async function check() {
    const next = await getAccess();
    if (next.kind === "signed_out") navigate({ to: "/auth", replace: true });
    else if (next.kind === "approved") navigate({ to: "/", replace: true });
    else setA(next);
  }
  useEffect(() => {
    check();
    const t = setInterval(check, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const rejected = a?.kind === "rejected";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border/70 bg-card p-6 text-center shadow-lg">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          {rejected ? <XCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
        </span>
        <h1 className="text-lg font-semibold text-foreground">
          {rejected ? "Erişim reddedildi" : "Onay bekleniyor"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {rejected
            ? "Hesabınıza erişim izni verilmedi."
            : "Kaydınız alındı. Yönetici onayladığında bu sayfa kendiliğinden açılacak."}
        </p>
        {a && "email" in a && a.email && <p className="text-xs text-muted-foreground">{a.email}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={check}>Yenile</Button>
          <Button variant="secondary" className="flex-1" onClick={signOut}>Çıkış</Button>
        </div>
      </div>
    </div>
  );
}
