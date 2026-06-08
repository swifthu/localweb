import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { ServerMsg, ClientMsg } from "./types.js";

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(
    getSnapshot?: () => ServerMsg,
    onClientMessage?: (msg: ClientMsg, ws: WebSocket) => void
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      if (getSnapshot) {
        const snap = getSnapshot();
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(snap));
      }
      if (onClientMessage) {
        ws.on("message", (raw) => {
          const msg = parseClientMessage(raw.toString());
          if (msg) onClientMessage(msg, ws);
        });
      }
      ws.on("close", () => this.clients.delete(ws));
    });
  }

  get server(): WebSocketServer {
    return this.wss;
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    for (const ws of this.clients) ws.close();
    this.wss.close();
  }
}

export function attachWs(httpServer: HttpServer, hub: WsHub): void {
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    hub.server.handleUpgrade(req, socket, head, (ws) => {
      hub.server.emit("connection", ws, req);
    });
  });
}

// Optional helper: parse incoming client messages.
export function parseClientMessage(raw: string): ClientMsg | null {
  try {
    return JSON.parse(raw) as ClientMsg;
  } catch {
    return null;
  }
}
