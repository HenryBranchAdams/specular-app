import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

if (document.getElementById('root') === null) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
}
