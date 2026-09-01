/**
 * Ambient types for the optional `ws` package used by the Node 20
 * WebSocket dev-compat shim in guest.server.ts. `ws` ships no types.
 */
declare module "ws" {
  export interface WebSocketLike {
    send(data: string | ArrayBufferView, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
    on(event: string, cb: (...args: unknown[]) => void): this;
    readyState: number;
  }
  export const WebSocket: {
    new (url: string, protocols?: string | string[]): WebSocketLike;
    CONNECTING: number;
    OPEN: number;
    CLOSING: number;
    CLOSED: number;
  };
  export default WebSocket;
}
