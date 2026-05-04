import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
          message: "Do not use `as unknown as`; replace it with a typed helper, schema, or module augmentation.",
        },
      ],
      "no-console": "error",
      "no-debugger": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["**/__tests__/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-deprecated": "off",
      "no-console": "off",
    },
  },
  {
    files: ["**/index.ts"],
    rules: {
      // Barrel re-exports deprecated symbols for backward compatibility
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["**/seed.ts", "**/email.ts", "**/auto-save.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["**/routes/**/*.ts", "**/ws/**/*.ts", "**/index.ts"],
    rules: {
      // Fastify plugin functions must be async per Fastify's contract,
      // even when the function body only calls server.get/post (sync registration).
      "@typescript-eslint/require-await": "off",
      // Fastify reply.send() and reply.status() return types don't resolve
      // cleanly under strictTypeChecked — these are safe Fastify API calls.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/return-await": "off",
      "no-console": "off",
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.js"],
  },
);
