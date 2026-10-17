// Preloaded for frontend tests only (see `test:client`): registers a DOM before
// Testing Library loads, and unmounts rendered trees after every test.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterEach } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost:3000/' });

const { cleanup } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  localStorage.clear();
});
