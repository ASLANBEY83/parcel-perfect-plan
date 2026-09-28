import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAccess } from "@/lib/access";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const access = await getAccess();
    if (access.kind === "signed_out") throw redirect({ to: "/auth" });
    if (access.kind !== "approved") throw redirect({ to: "/pending" });
    return { access };
  },
  component: () => <Outlet />,
});
