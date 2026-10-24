import { createServer } from 'node:http';

// Shell reads only. Stateful mutations belong to the real Planner, never a script.
export async function startReadFixture(runtime, reads) {
  const ledger = [];
  const server = createServer((req, res) => {
    req.resume();
    const response = req.method === 'GET' && Object.hasOwn(reads, req.url) ? reads[req.url]
      : { status: 404, body: { error: 'fixture_closed_route' } };
    ledger.push({ method: req.method, path: req.url, status: response.status, count: ledger.length + 1 });
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response.body));
  });
  return { origin: await runtime.listen(server), ledger };
}
