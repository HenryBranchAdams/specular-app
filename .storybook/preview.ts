import type { Preview } from '@storybook/react-vite';
import '../src/styles.css';

const preview: Preview = {
  parameters: {
    a11y: {
      test: 'error',
      options: { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    },
    controls: { expanded: true },
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default preview;
