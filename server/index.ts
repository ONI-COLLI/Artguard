import { createApp } from './app.js';
const port = Number(process.env.PORT || 3000);
const app = await createApp();
app.server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
  app.db.close();
});
app.server.listen(port, process.env.ARTGUARD_BIND_HOST || '127.0.0.1', () =>
  console.log(`ArtGuard API + built React app: http://localhost:${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
