import { withService } from './service.mjs';
await withService(async ({ root, pid }) => {
  process.stdout.write(JSON.stringify({ root, pid }) + '\n');
  await new Promise(() => {});
});
