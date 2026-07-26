import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

const sourceFiles = ['**/*.{js,mjs,ts,vue}']

export default tseslint.config(
  {
    ignores: [
      '.git/**',
      '.nuxt/**',
      '.output/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'public/vendor/**',
      'test-results/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: sourceFiles,
  },
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: ['**/*.{ts,vue}'],
  })),
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: sourceFiles,
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      vue,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        $fetch: 'readonly',
        computed: 'readonly',
        createError: 'readonly',
        defineEventHandler: 'readonly',
        defineNuxtConfig: 'readonly',
        defineNuxtPlugin: 'readonly',
        defineNuxtRouteMiddleware: 'readonly',
        definePageMeta: 'readonly',
        defineNitroPlugin: 'readonly',
        navigateTo: 'readonly',
        nextTick: 'readonly',
        onBeforeUnmount: 'readonly',
        onMounted: 'readonly',
        reactive: 'readonly',
        readonly: 'readonly',
        ref: 'readonly',
        useFetch: 'readonly',
        useHead: 'readonly',
        useNuxtApp: 'readonly',
        useRequestFetch: 'readonly',
        useRoute: 'readonly',
        useRuntimeConfig: 'readonly',
        useState: 'readonly',
        watch: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-control-regex': 'off',
      'no-undef': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'error',
    },
  },
  {
    files: ['tests/**/*.{js,ts}', 'scripts/**/*.{js,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },
)
