import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare, type WorkerConfig } from "@cloudflare/vite-plugin";
import { devtools } from "@tanstack/devtools-vite";
import { leanWorkerBundle } from "./vite-plugin-lean-worker-bundle";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = process.env.PORT
    ? Number(process.env.PORT)
    : env.PORT
      ? Number(env.PORT)
      : 3001;
  const showDevtools = env.VITE_SHOW_DEVTOOLS !== "false";
  const allowedHosts = [
    env.ALLOWED_HOST,
    env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).hostname : undefined,
  ].filter((host): host is string => Boolean(host));
  const emitSourcemaps = env.POSTHOG_SOURCEMAPS === "true";
  // Docker/local Postgres needs the binding on both workers. Credentials come
  // from Wrangler's runtime env override, never from the generated build files.
  const localPostgresConfig =
    env.DATABASE_PROVIDER === "postgres" &&
    env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
      ? (config: WorkerConfig) => ({
          vars: { ...config.vars, DATABASE_PROVIDER: "postgres" },
          hyperdrive: [
            ...(config.hyperdrive ?? []).filter(
              (binding) => binding.binding !== "HYPERDRIVE",
            ),
            {
              binding: "HYPERDRIVE",
              id: "00000000000000000000000000000000",
              localConnectionString:
                "postgres://openseo:unused@localhost:5432/openseo",
            },
          ],
        })
      : undefined;

  return {
    envPrefix: [
      "VITE_",
      "AUTH_MODE",
      "BYPASS_EMAIL_VERIFICATION",
      "POSTHOG_PUBLIC_KEY",
      "POSTHOG_HOST",
      "TURNSTILE_SITE_KEY",
    ],
    server: {
      allowedHosts,
      port,
    },
    preview: {
      allowedHosts,
      port,
    },
    build: {
      sourcemap: emitSourcemaps,
      outDir: emitSourcemaps ? "dist-sourcemaps" : "dist",
    },
    plugins: [
      leanWorkerBundle(),
      showDevtools
        ? devtools({
            consolePiping: {
              enabled: true,
              levels: ["log", "warn", "error", "info", "debug"],
            },
          })
        : null,
      cloudflare({
        config: localPostgresConfig,
        inspectorPort: false,
        viteEnvironment: { name: "ssr" },
        // The site-audit aux worker builds to dist/open_seo_audit/ and runs
        // beside the main worker in dev and preview, with the app's
        // cross-script SITE_AUDIT_WORKFLOW / AUDIT_SCRATCHPAD bindings
        // resolved against it.
        auxiliaryWorkers: [
          { configPath: "./wrangler.audit.jsonc", config: localPostgresConfig },
        ],
      }),
      tsConfigPaths(),
      tanstackStart(),
      viteReact(),
      tailwindcss(),
    ],
  };
});
