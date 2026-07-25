import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      pwaAssets: { image: "public/logo.svg" },
      manifest: {
        name: "The Uninvited Painter",
        short_name: "Painter",
        // App-level copy describes the app, not one room's settings — passes
        // are configurable, so the number stays out of it.
        description:
          "Everyone gets one stroke. One player was never told what the picture is.",
        theme_color: "#f2ede1",
        background_color: "#f2ede1",
        display: "standalone",
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // API calls (and the WS upgrade) must never be answered with the shell.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        ws: true,
      },
    },
  },
});
