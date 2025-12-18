import { io, Socket } from 'socket.io-client';
import { getApiConfig } from '../config';
import { getTokenStorage } from '../client';

export type SocketEvent =
  | 'connect'
  | 'disconnect'
  | 'error'
  | 'document:update'
  | 'document:delete'
  | 'page:create'
  | 'page:update'
  | 'page:delete'
  | 'element:create'
  | 'element:update'
  | 'element:delete'
  | 'element:bulk-update'
  | 'cursor:move'
  | 'user:join'
  | 'user:leave'
  | 'job:status'
  | 'export:complete'
  | 'ocr:complete';

export interface SocketEventData {
  'connect': void;
  'disconnect': string;
  'error': Error;
  'document:update': {
    document_id: string;
    user_id: string;
    changes: unknown;
  };
  'document:delete': {
    document_id: string;
    user_id: string;
  };
  'page:create': {
    document_id: string;
    page: unknown;
    user_id: string;
  };
  'page:update': {
    document_id: string;
    page_id: string;
    changes: unknown;
    user_id: string;
  };
  'page:delete': {
    document_id: string;
    page_id: string;
    user_id: string;
  };
  'element:create': {
    document_id: string;
    element: unknown;
    user_id: string;
  };
  'element:update': {
    document_id: string;
    element_id: string;
    changes: unknown;
    user_id: string;
  };
  'element:delete': {
    document_id: string;
    element_id: string;
    user_id: string;
  };
  'element:bulk-update': {
    document_id: string;
    elements: Array<{ id: string; changes: unknown }>;
    user_id: string;
  };
  'cursor:move': {
    document_id: string;
    user_id: string;
    user_name: string;
    position: { x: number; y: number };
    page_id?: string;
  };
  'user:join': {
    document_id: string;
    user_id: string;
    user_name: string;
    user_avatar?: string;
  };
  'user:leave': {
    document_id: string;
    user_id: string;
  };
  'job:status': {
    job_id: string;
    status: string;
    progress?: number;
    error?: string;
  };
  'export:complete': {
    export_id: string;
    document_id: string;
    status: string;
  };
  'ocr:complete': {
    job_id: string;
    document_id: string;
    status: string;
  };
}

/**
 * WebSocket client for real-time collaboration
 */
class SocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();

  /**
   * Connect to WebSocket server
   */
  connect(): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    const config = getApiConfig();
    const token = getTokenStorage().getAccessToken();

    this.socket = io(config.websocketURL, {
      auth: {
        token,
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    // Set up event listeners
    this.socket.on('connect', () => {
      console.log('[Socket] Connected');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    this.socket.on('error', (error) => {
      console.error('[Socket] Error:', error);
    });

    // Re-attach all listeners
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach((callback) => {
        this.socket?.on(event, callback);
      });
    });

    return this.socket;
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Check if socket is connected
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Join a document room for real-time updates
   */
  joinDocument(documentId: string): void {
    if (!this.socket?.connected) {
      this.connect();
    }
    this.socket?.emit('document:join', { document_id: documentId });
  }

  /**
   * Leave a document room
   */
  leaveDocument(documentId: string): void {
    this.socket?.emit('document:leave', { document_id: documentId });
  }

  /**
   * Subscribe to a socket event
   */
  on<K extends SocketEvent>(event: K, callback: (data: SocketEventData[K]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as (data: unknown) => void);

    if (this.socket?.connected) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.socket.on(event as string, callback as any);
    }
  }

  /**
   * Unsubscribe from a socket event
   */
  off<K extends SocketEvent>(
    event: K,
    callback: (data: SocketEventData[K]) => void
  ): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback as (data: unknown) => void);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }

    if (this.socket?.connected) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.socket.off(event as string, callback as any);
    }
  }

  /**
   * Emit a socket event
   */
  emit<K extends SocketEvent>(event: K, data: SocketEventData[K]): void {
    if (!this.socket?.connected) {
      this.connect();
    }
    this.socket?.emit(event, data);
  }

  /**
   * Send cursor position update
   */
  sendCursorPosition(
    documentId: string,
    position: { x: number; y: number },
    pageId?: string
  ): void {
    this.socket?.emit('cursor:move', {
      document_id: documentId,
      position,
      page_id: pageId,
    });
  }

  /**
   * Get the underlying socket instance
   */
  getSocket(): Socket | null {
    return this.socket;
  }
}

// Singleton instance
export const socketClient = new SocketClient();
