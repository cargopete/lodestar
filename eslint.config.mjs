import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    // wasm-bindgen output, built from the tattler crate and copied in. Generated code that no
    // rule here should have an opinion about, and editing it would be editing a build artefact.
    "public/tattler/**",
  ]),
]);

export default eslintConfig;
