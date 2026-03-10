import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: {
    resolve: true,
  },
  clean: true,
  skipNodeModulesBundle: true,
  external: ["socket.io-client", "immer", "zustand"],
});
