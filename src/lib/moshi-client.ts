/**
 * MoshiClient - WebSocket connection manager for Moshi Speech-to-Speech backend.
 * Implements the official Moshi wire protocol:
 *   0x00: Handshake [version, model]
 *   0x01: Audio payload (Ogg/Opus)
 *   0x02: Text payload (UTF-8)
 *   0x03: Control message (start, endTurn, pause, restart)
 */

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

type ControlAction = 'start' | 'endTurn' | 'pause' | 'restart';

const CONTROL_MAP: Record<ControlAction, number> = {
  start: 0,
  endTurn: 1,
  pause: 2,
  restart: 3,
};

export interface MoshiClientOptions {
  url: string; // e.g. ws://localhost:8998/api/chat
  autoReconnect?: boolean;
  onStateChange?: (state: ConnectionState) => void;
  onAudioReceived?: (chunk: ArrayBuffer) => void;
  onTextReceived?: (text: string) => void;
  onError?: (error: Error) => void;
}

export class MoshiClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private handshakeSent = false;

  constructor(private options: MoshiClientOptions) {}

  public connect(): void {
    if (this.state === 'CONNECTING' || this.state === 'CONNECTED') return;

    this.setState('CONNECTING');
    this.clearTimers();
    this.handshakeSent = false;

    try {
      this.ws = new WebSocket(this.options.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[MoshiClient] WebSocket connected, sending handshake');
        this.reconnectAttempts = 0;

        // Send handshake: [0x00, version=0, model=0]
        const handshake = new Uint8Array([0x00, 0, 0]);
        this.ws!.send(handshake.buffer);
        this.handshakeSent = true;

        this.setState('CONNECTED');
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const view = new Uint8Array(event.data);
          if (view.length === 0) return;

          const tag = view[0];
          const payload = event.data.slice(1);

          switch (tag) {
            case 0x00:
              // Handshake acknowledgment from server
              console.log('[MoshiClient] Handshake acknowledged');
              break;

            case 0x01:
              // Audio payload (Ogg/Opus data)
              if (this.options.onAudioReceived && payload.byteLength > 0) {
                this.options.onAudioReceived(payload);
              }
              break;

            case 0x02: {
              // Text payload (UTF-8)
              const text = new TextDecoder('utf-8').decode(payload);
              if (this.options.onTextReceived) {
                this.options.onTextReceived(text);
              }
              break;
            }

            case 0x03:
              // Control message from server
              console.log('[MoshiClient] Control message:', new Uint8Array(payload)[0]);
              break;

            default:
              // Unknown tag - treat as raw audio
              if (this.options.onAudioReceived) {
                this.options.onAudioReceived(event.data);
              }
              break;
          }
        } else if (typeof event.data === 'string') {
          // Text message
          if (this.options.onTextReceived) {
            this.options.onTextReceived(event.data);
          }
        }
      };

      this.ws.onerror = () => {
        const err = new Error(`WebSocket error connecting to ${this.options.url}`);
        if (this.options.onError) {
          this.options.onError(err);
        }
        this.setState('ERROR');
      };

      this.ws.onclose = (event) => {
        console.log('[MoshiClient] WebSocket closed:', event.code, event.reason);
        this.setState('DISCONNECTED');
        this.clearTimers();
        if (this.options.autoReconnect && this.reconnectAttempts < 5) {
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
          this.reconnectAttempts++;
          this.reconnectTimer = setTimeout(() => this.connect(), delay);
        }
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.setState('ERROR');
      if (this.options.onError) {
        this.options.onError(error);
      }
    }
  }

  /**
   * Send an encoded Ogg/Opus audio chunk to the server.
   * Wraps with 0x01 audio tag prefix.
   */
  public sendAudioChunk(chunk: ArrayBuffer | Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.handshakeSent) return;

    const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const tagged = new Uint8Array(1 + data.byteLength);
    tagged[0] = 0x01; // Audio tag
    tagged.set(data, 1);
    this.ws.send(tagged);
  }

  /**
   * Send a control message to the server.
   */
  public sendControl(action: ControlAction): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = new Uint8Array([0x03, CONTROL_MAP[action]]);
    this.ws.send(msg.buffer);
  }

  /**
   * Send a text message to the server.
   */
  public sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const textBytes = new TextEncoder().encode(text);
    const tagged = new Uint8Array(1 + textBytes.length);
    tagged[0] = 0x02; // Text tag
    tagged.set(textBytes, 1);
    this.ws.send(tagged.buffer);
  }

  public disconnect(): void {
    this.clearTimers();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.handshakeSent = false;
    this.setState('DISCONNECTED');
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    if (this.options.onStateChange) {
      this.options.onStateChange(state);
    }
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public setUrl(url: string): void {
    this.options.url = url;
    if (this.state === 'CONNECTED') {
      this.disconnect();
      this.connect();
    }
  }
}
