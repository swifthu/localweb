import net from "node:net";

export async function findPort(start: number, end: number): Promise<number> {
  for (let p = start; p <= end; p++) {
    if (await isFree(p)) return p;
  }
  throw new Error(`no free port in range ${start}-${end}`);
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}
