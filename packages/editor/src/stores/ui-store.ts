/**
 * UI Store - User interface state management
 * Manages panels, modals, notifications, and UI preferences
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  UIState,
  PanelType,
  ModalType,
  Notification,
  ContextMenuItem,
} from "../types";

export interface UIStore extends UIState {
  // Sidebar actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setActivePanel: (panel: PanelType) => void;

  // Modal actions
  openModal: (type: ModalType, data?: Record<string, unknown>) => void;
  closeModal: () => void;

  // Theme actions
  setTheme: (theme: UIState["theme"]) => void;
  toggleTheme: () => void;

  // Grid and guides actions
  toggleGrid: () => void;
  setShowGrid: (show: boolean) => void;
  toggleGuides: () => void;
  setShowGuides: (show: boolean) => void;

  // Notification actions
  addNotification: (
    notification: Omit<Notification, "id" | "timestamp">
  ) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;

  // Context menu actions
  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeContextMenu: () => void;

  // Editor panel/mode actions
  toggleFormsPanel: () => void;
  setShowFormsPanel: (show: boolean) => void;
  toggleContentEdit: () => void;
  setContentEditActive: (active: boolean) => void;

  reset: () => void;
}

const initialState: UIState = {
  sidebarOpen: true,
  sidebarWidth: 280,
  activePanel: "pages",
  modalOpen: null,
  modalData: null,
  theme: "system",
  showGrid: false,
  showGuides: true,
  notifications: [],
  contextMenu: null,
  showFormsPanel: false,
  isContentEditActive: false,
};

export const useUIStore: UseBoundStore<StoreApi<UIStore>> = create<UIStore>()(
  immer((set, get) => ({
    ...initialState,

    // Sidebar
    toggleSidebar: () =>
      set((state) => {
        state.sidebarOpen = !state.sidebarOpen;
      }),

    setSidebarOpen: (open) =>
      set((state) => {
        state.sidebarOpen = open;
      }),

    setSidebarWidth: (width) =>
      set((state) => {
        state.sidebarWidth = Math.max(200, Math.min(600, width));
      }),

    setActivePanel: (panel) =>
      set((state) => {
        state.activePanel = panel;
        // Open sidebar when switching panels
        if (!state.sidebarOpen) {
          state.sidebarOpen = true;
        }
      }),

    // Modal
    openModal: (type, data) =>
      set((state) => {
        state.modalOpen = type;
        state.modalData = data || null;
      }),

    closeModal: () =>
      set((state) => {
        state.modalOpen = null;
        state.modalData = null;
      }),

    // Theme
    setTheme: (theme) =>
      set((state) => {
        state.theme = theme;
      }),

    toggleTheme: () =>
      set((state) => {
        if (state.theme === "light") {
          state.theme = "dark";
        } else if (state.theme === "dark") {
          state.theme = "system";
        } else {
          state.theme = "light";
        }
      }),

    // Grid and guides
    toggleGrid: () =>
      set((state) => {
        state.showGrid = !state.showGrid;
      }),

    setShowGrid: (show) =>
      set((state) => {
        state.showGrid = show;
      }),

    toggleGuides: () =>
      set((state) => {
        state.showGuides = !state.showGuides;
      }),

    setShowGuides: (show) =>
      set((state) => {
        state.showGuides = show;
      }),

    // Notifications
    addNotification: (notification) =>
      set((state) => {
        const newNotification: Notification = {
          ...notification,
          id: `notif-${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
        };

        state.notifications.push(newNotification);

        // Auto-remove notification after duration
        if (notification.autoClose && notification.duration) {
          setTimeout(() => {
            get().removeNotification(newNotification.id);
          }, notification.duration);
        }
      }),

    removeNotification: (id) =>
      set((state) => {
        const index = state.notifications.findIndex((n) => n.id === id);
        if (index !== -1) {
          state.notifications.splice(index, 1);
        }
      }),

    clearNotifications: () =>
      set((state) => {
        state.notifications = [];
      }),

    // Context menu
    openContextMenu: (x, y, items) =>
      set((state) => {
        state.contextMenu = { x, y, items };
      }),

    closeContextMenu: () =>
      set((state) => {
        state.contextMenu = null;
      }),

    // Editor panel/mode actions
    toggleFormsPanel: () =>
      set((state) => {
        state.showFormsPanel = !state.showFormsPanel;
      }),

    setShowFormsPanel: (show) =>
      set((state) => {
        state.showFormsPanel = show;
      }),

    toggleContentEdit: () =>
      set((state) => {
        state.isContentEditActive = !state.isContentEditActive;
      }),

    setContentEditActive: (active) =>
      set((state) => {
        state.isContentEditActive = active;
      }),

    reset: () => set(initialState),
  }))
);
