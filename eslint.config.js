import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module"
      },
      globals: {
        // Node.js globals
        process: true,
        console: true,
        setTimeout: true,
        setInterval: true,
        clearTimeout: true,
        clearInterval: true,
        Buffer: true,
        module: true,
        require: true,
        __dirname: true,
        __filename: true,
        global: true
      }
    },
    plugins: {
      "@typescript-eslint": typescript
    },
    rules: {
      ...typescript.configs["recommended"].rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn"],
      // Allow console.warn and console.error, but warn about other console methods
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Since we're working with Node.js, these globals are fine
      "no-undef": "error"
    },
    files: ["**/*.ts"],
    ignores: ["dist/**", "node_modules/**"]
  }
];