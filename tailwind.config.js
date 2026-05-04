import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            // Strip the wrapping backticks Typography adds around inline code.
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            // Pill styling for inline code only — leaves `pre code` alone so
            // code-block text inherits the block's color (see `pre code` below).
            ':not(pre) > code': {
              backgroundColor: theme('colors.slate.100'),
              borderRadius: theme('borderRadius.DEFAULT'),
              padding: `${theme('spacing[0.5]')} ${theme('spacing.1')}`,
              fontSize: theme('fontSize.xs')[0],
              fontWeight: 'inherit',
            },
            // Code blocks: light background that doesn't fight the page tone.
            pre: {
              backgroundColor: theme('colors.slate.50'),
              color: theme('colors.slate.800'),
              border: `1px solid ${theme('colors.slate.200')}`,
            },
            'pre code': { color: 'inherit' },
          },
        },
        invert: {
          css: {
            ':not(pre) > code': {
              backgroundColor: theme('colors.slate.800'),
            },
            pre: {
              backgroundColor: theme('colors.slate.900'),
              color: theme('colors.slate.100'),
              borderColor: theme('colors.slate.700'),
            },
          },
        },
      }),
    },
  },
  plugins: [typography],
};
