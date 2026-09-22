import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.argv[2] ?? 4174);
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/styles.css", ["styles.css", "text/css"]],
  ["/app.mjs", ["app.mjs", "text/javascript"]],
  ["/optics.mjs", ["optics.mjs", "text/javascript"]],
]);

createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const asset = assets.get(pathname);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  try {
    const file = await readFile(new URL(asset[0], import.meta.url));
    response.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8" }).end(file);
  } catch {
    response.writeHead(500).end("Unable to load demo asset.");
  }
}).listen(port, "127.0.0.1", function () {
  console.log(`Adaptive Optics Lab at http://127.0.0.1:${this.address().port}`);
});
