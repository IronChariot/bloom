import { DurableObject } from 'cloudflare:workers';
import { join, receive, leave, announce, storable } from '../lib/room.js';

// One instance per board. WebSocket hibernation keeps it asleep (and free of duration charges)
// whenever nobody is sending anything; pings are answered without waking it. Everything it
// knows about a connection lives in that socket's attachment, which survives hibernation.
export class BoardRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  sockets() {
    return this.ctx.getWebSockets().map(ws => {
      const meta = ws.deserializeAttachment();
      return meta && { ws, meta, send: text => ws.send(text) };
    }).filter(Boolean);
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/announce' && request.method === 'POST') {
      for (const socket of announce(this.sockets(), await request.json())) { try { socket.ws.close(4003, 'Removed from this board'); } catch {} }
      return new Response(null, { status: 204 });
    }
    if (url.pathname !== '/connect' || request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    const member = JSON.parse(request.headers.get('X-Bloom-Member'));
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(storable({ id: member.sessionId, userId: member.userId, name: member.name, color: member.color }));
    const sockets = this.sockets();
    join(sockets, sockets.find(s => s.ws === server));
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, message) {
    const sockets = this.sockets(), socket = sockets.find(s => s.ws === ws); if (!socket) return;
    const change = receive(sockets, socket, typeof message === 'string' ? message : '');
    if (change) ws.serializeAttachment(storable({ ...socket.meta, ...change }));
  }
  webSocketClose(ws) { this.depart(ws); try { ws.close(1000, 'Closed'); } catch {} }
  webSocketError(ws) { this.depart(ws); }
  // The closing socket may or may not still be listed, so rebuild the room without it.
  depart(ws) {
    const meta = ws.deserializeAttachment(); if (!meta) return;
    const socket = { ws, meta, send() {} };
    leave(this.sockets().filter(s => s.ws !== ws).concat(socket), socket);
  }
}
