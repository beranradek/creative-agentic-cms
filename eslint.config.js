import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      ".workspace/**",
      "**/dist/**",
      "**/node_modules/**",
      "docs/examples/**",
      "output/**",
      "projects/**",
      "temp/**",
      "packages/**/coverage/**",
      "packages/**/.vite/**",
      "packages/**/.cache/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        fetch: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
];
