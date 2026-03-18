import { create } from 'zustand';

interface DevState {
  devMode: boolean;
  toggleDevMode: () => void;
}

export const useDevStore = create<DevState>((set) => ({
  devMode: false,
  toggleDevMode: () => set((state) => ({ devMode: !state.devMode })),
}));
