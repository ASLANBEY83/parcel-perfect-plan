import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Row = { id: string; email: string | null; full_name: string | null; status: "pending" | "approved" | "rejected"; created_at: string };

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: ({ context }) => {
    const acc = (context as { access?: { kind: string; isAdmin?: boolean } }).access;
    if (!acc || acc.kind !== "approved" || !acc.isAdmin) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Kullanıcı Onayları | Parselasyon Optimizasyon" },
      { name: "description", content: "Yönetici kullanıcı kayıt onay paneli." },
      { property: "og:title", content: "Kullanıcı Onayları" },
      { property: "og:description", content: "Yönetici kullanıcı kayıt onay paneli." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Admin,
});

const LABEL = { pending: "Bekliyor", approved: "Onaylı", rejected: "Reddedildi" } as const;

function Admin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,full_name,status,created_at")
      .order("created_at", { ascending: false });
    if (error) setErr("Liste yüklenemedi.");
    else setRows((data ?? []) as Row[]);
  }
  useEffect(() => { load(); }, []);

  async function setStatus(id: string, status: Row["status"]) {
    const { error } = await supabase
      .from("profiles")
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) setErr("Güncellenemedi.");
    load();
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Kullanıcı Onayları</h1>
          <Link to="/" className="text-sm text-primary hover:underline">Uygulamaya dön</Link>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">Kayıt yok.</p>}
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{r.full_name ?? r.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.email} · {new Date(r.created_at).toLocaleString("tr-TR")} · {LABEL[r.status]}
                </p>
              </div>
              {r.status !== "approved" && <Button size="sm" onClick={() => setStatus(r.id, "approved")}>Onayla</Button>}
              {r.status !== "rejected" && (
                <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "rejected")}>Reddet</Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
