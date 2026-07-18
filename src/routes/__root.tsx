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
      { title: "EMBERLORD — Command Netflix on any TV" },
      { name: "description", content: "Wield the trident. Enter your 8-digit code and unleash Netflix on Smart TV, Apple TV, Roku, PS5 and more. Cinematic, encrypted, always-on." },
      { name: "author", content: "Emberlord" },
      { name: "theme-color", content: "#0a0000" },
      { property: "og:title", content: "EMBERLORD — Command Netflix on any TV" },
      { property: "og:description", content: "8-digit TV activation, encrypted end-to-end. Every device. Every screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
        duration={5000}
        toastOptions={{
          classNames: {
            toast:
              "!bg-[#0b0b0d]/95 !backdrop-blur-xl !border !border-white/10 !shadow-[0_20px_60px_-20px_rgba(255,42,58,0.35)] !rounded-xl !px-4 !py-3.5",
            title: "!font-display !text-[15px] !tracking-tight !text-white",
            description: "!text-[12.5px] !text-white/60 !leading-relaxed !mt-0.5",
            success: "!border-emerald-500/30 [&_[data-icon]]:!text-emerald-400",
            error: "!border-red-500/40 [&_[data-icon]]:!text-red-400",
            info: "!border-sky-500/30 [&_[data-icon]]:!text-sky-300",
            warning: "!border-amber-500/30 [&_[data-icon]]:!text-amber-300",
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
        endsAt={gate.data.maintenanceEndsAt ?? null}
        onCleared={() => qc.invalidateQueries({ queryKey: ["public-gate"] })}
      />
    );
  }
  return <>{children}</>;
}

