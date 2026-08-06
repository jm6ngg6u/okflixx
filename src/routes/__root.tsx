import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import "../lib/toast-format";
import { BrandingProvider } from "../lib/branding-context";
import { supabase } from "../integrations/supabase/client";
import { getGateConfig } from "../lib/access-keys.functions";
import { MaintenanceScreen } from "../components/MaintenanceScreen";

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
      { title: "OKFLIX — Activate Netflix on any TV" },
      { name: "description", content: "Enter your 8-digit code and stream Netflix instantly on any Smart TV, Apple TV, Roku, PS5 or Xbox. Encrypted, always-on, 2026-ready." },
      { name: "author", content: "OKFLIX" },
      { name: "theme-color", content: "#0a0000" },
      { property: "og:title", content: "OKFLIX — Activate Netflix on any TV" },
      { property: "og:description", content: "Enter your 8-digit code and stream Netflix instantly on any Smart TV, Apple TV, Roku, PS5 or Xbox. Encrypted, always-on, 2026-ready." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "OKFLIX — Activate Netflix on any TV" },
      { name: "twitter:description", content: "Enter your 8-digit code and stream Netflix instantly on any Smart TV, Apple TV, Roku, PS5 or Xbox. Encrypted, always-on, 2026-ready." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/25f5960b-fd35-4059-802f-7f790d7e6369/id-preview-2786a24d--9c504117-6746-45b6-95c8-55e609b4b713.lovable.app-1784498698152.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/25f5960b-fd35-4059-802f-7f790d7e6369/id-preview-2786a24d--9c504117-6746-45b6-95c8-55e609b4b713.lovable.app-1784498698152.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600;700&family=Work+Sans:wght@300;400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
  // Prefetch the gate on SSR so the maintenance takeover renders on the very
  // first paint — no flash of the activation UI before the client swap.
  loader: async ({ context }) => {
    try {
      const gate = await context.queryClient.ensureQueryData({
        queryKey: ["public-gate"],
        queryFn: () => getGateConfig(),
        staleTime: 2000,
      });
      return { gate };
    } catch {
      return { gate: null as null };
    }
  },
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

function PostLoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    let mounted = true;
    // Fire once on mount in case we already have a session from the OAuth return.
    (async () => {
      const { consumeRedirect } = await import("../lib/post-login-redirect");
      const { data } = await supabase.auth.getSession();
      if (!mounted || !data.session) return;
      const target = consumeRedirect();
      if (target && target !== window.location.pathname + window.location.search) {
        router.navigate({ to: target, replace: true });
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event: string) => {
      if (event !== "SIGNED_IN") return;
      const { consumeRedirect } = await import("../lib/post-login-redirect");
      const target = consumeRedirect();
      if (target) router.navigate({ to: target, replace: true });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <PostLoginRedirect />
        <MaintenanceGate>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </MaintenanceGate>

      <Toaster
        theme="dark"
        position="top-center"
        richColors
        closeButton
        expand
        toastOptions={{
          classNames: {
            toast:
              "!bg-[var(--toast-bg)] !backdrop-blur-xl !border !border-[var(--toast-border)] !shadow-[var(--toast-shadow)] !rounded-[var(--toast-radius)] !px-[var(--toast-pad-x)] !py-[var(--toast-pad-y)]",
            title: "!font-display !text-[length:var(--toast-title-size)] !tracking-tight !text-white",
            description: "!font-body !text-[length:var(--toast-desc-size)] !text-white/60 !leading-relaxed !mt-0.5",
            success: "!border-[color:var(--toast-success)]/30 [&_[data-icon]]:!text-[color:var(--toast-success)]",
            error: "!border-[color:var(--toast-error)]/40 [&_[data-icon]]:!text-[color:var(--toast-error)]",
            info: "!border-[color:var(--toast-info)]/30 [&_[data-icon]]:!text-[color:var(--toast-info)]",
            warning: "!border-[color:var(--toast-warning)]/30 [&_[data-icon]]:!text-[color:var(--toast-warning)]",
            loading: "!border-white/10 [&_[data-icon]]:!text-[color:var(--toast-loading)]",
            closeButton: "!bg-white/5 !border-white/10 !text-white/60 hover:!text-white",
          },
        }}
      />


      </BrandingProvider>
    </QueryClientProvider>
  );
}

/**
 * Global maintenance takeover. When admin has maintenance mode ON (manual or
 * inside the scheduled window), replaces every public route with a full-screen
 * MaintenanceScreen. Admin, auth, login, and preview routes are exempt so
 * staff can still log in and disable maintenance. Uses the same public-gate
 * query as the landing page (Realtime-invalidated), so state flips within a
 * couple of seconds across every open tab.
 */
function MaintenanceGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();
  const fetchGate = useServerFn(getGateConfig);
  // Loader-primed gate — present on the very first server-rendered paint.
  const { gate: initialGate } = Route.useLoaderData();

  // Match the landing page's query key/shape so cache is shared.
  const gate = useQuery({
    queryKey: ["public-gate"],
    queryFn: () => fetchGate(),
    initialData: initialGate ?? undefined,
    staleTime: 2000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const exempt =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/bg-preview") ||
    pathname.startsWith("/api/");

  if (!exempt && gate.data?.maintenance) {
    return (
      <MaintenanceScreen
        message={gate.data.maintenanceMessage || ""}
        startsAt={gate.data.maintenanceStartsAt ?? null}
        endsAt={gate.data.maintenanceEndsAt ?? null}
        onCleared={() => qc.invalidateQueries({ queryKey: ["public-gate"] })}
      />
    );
  }
  return <>{children}</>;
}

