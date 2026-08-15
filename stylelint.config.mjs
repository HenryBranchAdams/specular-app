export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['storybook-static/**', 'dist/**'],
  rules: {
    'alpha-value-notation': null,
    'color-function-notation': 'modern',
    'custom-property-empty-line-before': null,
    'declaration-block-single-line-max-declarations': null,
    'declaration-empty-line-before': null,
    'import-notation': 'string',
    'media-feature-range-notation': 'prefix',
    'no-descending-specificity': null,
    'selector-class-pattern': null,
    'value-keyword-case': ['lower', {
      ignoreKeywords: ['BlinkMacSystemFont', 'optimizeLegibility'],
    }],
  },
};
