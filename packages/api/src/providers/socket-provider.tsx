import { ReactNode, useEffect, createContext, useContext } from 'react';
import { socketClient } from '../websocket/client';
import { useSocket } from '../websocket/hooks';

interface SocketContextValue {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

interface SocketProviderProps {
  children: ReactNode;
  autoConnect?: boolean;
}

/**
 * Socket.IO provider component
 */
export const SocketProvider = ({ children, autoConnect = true }: SocketProviderProps) => {
  const socket = useSocket();

  useEffect(() => {
    if (autoConnect) {
      socketClient.connect();
    }

    return () => {
      if (autoConnect) {
        socketClient.disconnect();
      }
    };
  }, [autoConnect]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
};

/**
 * Hook to access socket context
 */
export const useSocketContext = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocketContext must be used within SocketProvider');
  }
  return context;
};
