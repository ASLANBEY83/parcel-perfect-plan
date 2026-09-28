import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Parselasyon Optimizasyon Uygulaması" },
      { name: "description", content: "İmar adası DXF verisinden kurallara uygun maksimum geçerli parsel ve yapı bloğu üreten teknik analiz uygulaması." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Parselasyon Optimizasyon Uygulaması" },
      { property: "og:description", content: "DXF imar adalarını gerçek geometriyle analiz edin, parsel ve yapı kurallarını denetleyin." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** Kopyalamayı caydırıcı önlemler: sağ tık, seçim, kes/kopyala ve kaydet/incele kısayolları. */
function CopyProtection() {
  useEffect(() => {
    const block = (e: Event) => {
      const t = e.target as HTMLElement | null;
      // Form alanlarında kopyala/yapıştır çalışmaya devam etsin.
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && ["s", "u", "p", "c"].includes(k)) {
        const t = e.target as HTMLElement | null;
        if (k === "c" && t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        e.preventDefault();
      }
      if (e.key === "F12") e.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    document.addEventListener("selectstart", block);
    document.addEventListener("dragstart", block);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
      document.removeEventListener("selectstart", block);
      document.removeEventListener("dragstart", block);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}

/** Ekran görüntüsü alınsa bile kaynağı belli eden, tıklamayı engellemeyen filigran. */
function Watermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999] select-none overflow-hidden"
    >
      <div
        className="absolute -inset-1/2 flex flex-wrap content-center justify-center gap-24 opacity-[0.045]"
        style={{ transform: "rotate(-24deg)" }}
      >
        {Array.from({ length: 60 }).map((_, i) => (
          <span key={i} className="whitespace-nowrap text-lg font-semibold text-foreground">
            İFRAZ • Parselasyon Optimizasyon
          </span>
        ))}
      </div>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <CopyProtection />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Watermark />
    </QueryClientProvider>
  );
}
