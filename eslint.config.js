// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    rules: {
      // Disable unresolved import rule (path aliases and optional native modules cause many false positives in this workspace)
      'import/no-unresolved': 'off',
      // Some components created anonymously in the app trigger display-name rule
      'react/display-name': 'off',
    },
  },
]);
