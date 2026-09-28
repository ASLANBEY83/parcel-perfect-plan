import { supabase } from "@/integrations/supabase/client";

export type AccessState =
  | { kind: "signed_out" }
  | { kind: "pending" | "rejected"; email: string | null }
  | { kind: "approved"; email: string | null; isAdmin: boolean };

/** Oturum + onay durumunu veritabanından (RLS altında) okur. */
export async function getAccess(): Promise<AccessState> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "signed_out" };
  const uid = data.user.id;
  const [{ data: prof }, { data: isAdmin }] = await Promise.all([
    supabase.from("profiles").select("status,email").eq("id", uid).maybeSingle(),
    supabase.rpc("has_role", { _user_id: uid, _role: "admin" }),
  ]);
  const email = prof?.email ?? data.user.email ?? null;
  if (!prof || prof.status === "pending") return { kind: "pending", email };
  if (prof.status === "rejected") return { kind: "rejected", email };
  return { kind: "approved", email, isAdmin: !!isAdmin };
}
