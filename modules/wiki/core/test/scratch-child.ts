// Helper process for scratch.test.ts: creates a scratch root, reports it and then waits to be cancelled.
import { createScratch, currentBase } from './scratch.ts';

const scratch = createScratch(process.argv[2] ?? 'child');
process.stdout.write(`${JSON.stringify({ root: scratch.root, base: currentBase() })}\n`);
setInterval(() => undefined, 1000);
