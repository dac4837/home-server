module.exports = [
  {
    ignores: ['node_modules'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
      },
      globals: {
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
