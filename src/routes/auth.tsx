import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { lovable } from "@/integrations/lovable/index";
import { getAccess } from "@/lib/access";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Giriş | Parselasyon Optimizasyon" },
      { name: "description", content: "Google hesabınızla giriş yapın; erişim yönetici onayından sonra açılır." },
      { property: "og:title", content: "Giriş | Parselasyon Optimizasyon" },
      { property: "og:description", content: "Google ile kayıt ve yönetici onaylı erişim." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getAccess().then((a) => {
      if (a.kind === "approved") navigate({ to: "/", replace: true });
      else if (a.kind !== "signed_out") navigate({ to: "/pending", replace: true });
    });
  }, [navigate]);

  async function signIn() {
    setBusy(true);
    setErr(null);
    const res = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth",
      extraParams: { prompt: "select_account" },
    });
    if (res.error) {
      setErr("Google ile giriş başarısız oldu, tekrar deneyin.");
      setBusy(false);
      return;
    }
    if (res.redirected) return;
    const a = await getAccess();
    navigate({ to: a.kind === "approved" ? "/" : "/pending", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-border/70 bg-card p-6 text-center shadow-lg">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Parselasyon Optimizasyon</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Google hesabınızla kayıt olun. Yönetici onayladıktan sonra giriş yapabilirsiniz.
          </p>
        </div>
        <Button className="w-full" onClick={signIn} disabled={busy}>
          {busy ? "Yönlendiriliyor…" : "Google ile devam et"}
        </Button>
        {err && <p className="text-sm font-medium text-destructive">{err}</p>}
      </div>
    </div>
  );
}
