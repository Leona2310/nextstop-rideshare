module.exports = {
  root: true,
  rules: {
    // Many unresolved imports come from path aliases and optional native modules
    // while developing in different environments. Relax this rule to reduce noise.
    'import/no-unresolved': 'off',
    // Some components are created anonymously in this project; relax the rule.
    'react/display-name': 'off',
  },
  settings: {
    react: {
      version: 'detect'
    }
  }
};
