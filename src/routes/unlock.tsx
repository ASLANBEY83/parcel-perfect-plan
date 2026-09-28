import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Lock } from "lucide-react";
import { unlockSite } from "@/lib/gate.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/unlock")({
  head: () => ({
    meta: [
      { title: "Giriş | Parselasyon Optimizasyon" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Unlock,
});

function Unlock() {
  const router = useRouter();
  const unlock = useServerFn(unlockSite);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const password = String(new FormData(e.currentTarget).get("password") ?? "");
      const { ok } = await unlock({ data: { password } });
      if (ok) {
        await router.invalidate();
        await router.navigate({ to: "/" });
      } else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border/70 bg-card p-6 shadow-lg"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Lock className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold text-foreground">Korumalı Alan</h1>
          <p className="text-sm text-muted-foreground">
            Devam etmek için site şifresini girin.
          </p>
        </div>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Site şifresi"
          autoFocus
          required
        />
        {error && (
          <p className="text-sm font-medium text-destructive">Şifre hatalı, tekrar deneyin.</p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Kontrol ediliyor…" : "Giriş"}
        </Button>
      </form>
    </div>
  );
}
