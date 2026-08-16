import { startServer } from '../src/server.js';

const port = Number(process.env.DEVTOOLKIT_E2E_PORT || 4173);
const server = startServer({
  port,
  sessionToken: 'e2e-session-token',
  projectRoot: process.cwd(),
});

const close = () => server.close(() => process.exit(0));
process.once('SIGTERM', close);
process.once('SIGINT', close);
