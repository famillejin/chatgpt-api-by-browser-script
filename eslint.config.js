module.exports = [
  {
    files: ['*.js'],
    languageOptions: {
      globals: {
        browser: true,
        node: true,
        es2021: true,
      },
      parserOptions: {
        ecmaVersion: 12,
        sourceType: 'module',
      },
    },
    extends: [
      'airbnb-base',
      'plugin:import/errors',
      'plugin:import/warnings',
      'plugin:n/recommended',
      'plugin:promise/recommended'
    ],
    rules: {
      'no-console': 'off',
      'import/extensions': 'off',
    },
  },
];
