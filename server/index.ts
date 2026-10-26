// ============================================================================
// server/index.ts — Entrypoint for Signage Management Network Server
// ============================================================================

import path from 'node:path';
import { buildServerApp } from './app';

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const dbPath = path.resolve(process.cwd(), '.storage/signage-server.db');
  const storageDir = path.resolve(process.cwd(), '.storage/packages');
  const { app } = await buildServerApp({ dbPath, storageDir });

  await app.listen({ port: PORT, host: HOST });
  console.log(`Signage Management Server listening on http://${HOST}:${PORT}`);
  console.log(`LAN discovery endpoint: GET http://${HOST}:${PORT}/api/v1/discovery`);
}

main().catch((err) => {
  console.error('Failed to start Signage Management Server:', err);
  process.exit(1);
});
