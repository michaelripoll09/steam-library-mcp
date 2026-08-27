import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dashboardApiTarget = new URL(`http://127.0.0.1:${process.env.DASHBOARD_PORT ?? "4173"}`);
const dashboardUiPort = Number(process.env.DASHBOARD_UI_PORT ?? "5173");

export default defineConfig({
  plugins: [react()],
  root: "dashboard-ui",
  server: {
    host: "127.0.0.1",
    port: dashboardUiPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: dashboardApiTarget.origin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyRequest, request) => {
            proxyRequest.setHeader("host", dashboardApiTarget.host);
            if (isExpectedViteOrigin(request.headers.origin, request.headers.host)) {
              proxyRequest.setHeader("origin", dashboardApiTarget.origin);
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "../dist/dashboard-ui",
    emptyOutDir: true,
  },
});

function isExpectedViteOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined || host === undefined) return false;
  try {
    const viteOrigin = new URL(`http://${host}`);
    return viteOrigin.hostname === "127.0.0.1" && origin === viteOrigin.origin;
  } catch {
    return false;
  }
}
