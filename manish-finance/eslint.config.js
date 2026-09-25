import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", ".local/", "release/", "harness/dist/", "test-results/", "playwright-report/", "*.zip"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "off",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["src/**/*.tsx"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...jsxA11y.configs.recommended.rules,
      // Dialog scrims close on click and have keyboard equivalents (Escape / close button).
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
    },
  },
  {
    // The Worker module must not reach for Node or process globals at runtime.
    files: ["server/**/*.ts", "shared/**/*.ts"],
    languageOptions: { globals: { ...globals.worker } },
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["node:*", "fs", "path", "child_process", "os"], message: "The finance Worker module must use Workers APIs only." }] }],
      "no-restricted-globals": ["error", { name: "process", message: "Use env bindings, not process." }, { name: "__dirname", message: "Not available in Workers." }],
    },
  },
);
