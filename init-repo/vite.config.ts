import { defineConfig } from "vite";
import { localapp } from "@localapp/app-kit/vite";

export default defineConfig({
  base: "./",
  plugins: [localapp()],
});
