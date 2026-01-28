import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { CanvasData, Milestone, NextStep } from '@/types/canvas';

interface CanvasState {
  canvasData: CanvasData | null;
  originalData: CanvasData | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  activeCell: string | null;

  setCanvasData: (data: CanvasData) => void;
  clearCanvasData: () => void;
  updateField: (path: string, value: unknown) => void;
  addNextStep: (step: Omit<NextStep, 'id'>) => void;
  removeNextStep: (stepId: string) => void;
  toggleNextStep: (stepId: string) => void;
  addMilestone: (milestone: Omit<Milestone, 'id'>) => void;
  removeMilestone: (milestoneId: string) => void;
  updateMilestone: (milestoneId: string, updates: Partial<Milestone>) => void;
  setActiveCell: (cellId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
  resetChanges: () => void;
  markClean: () => void;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj as Record<string, unknown>;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export const useCanvasStore = create<CanvasState>()(
  immer((set) => ({
    canvasData: null,
    originalData: null,
    isLoading: false,
    isSaving: false,
    error: null,
    activeCell: null,

    setCanvasData: (data) =>
      set((state) => {
        state.canvasData = data;
        state.originalData = JSON.parse(JSON.stringify(data));
        state.error = null;
      }),

    clearCanvasData: () =>
      set((state) => {
        state.canvasData = null;
        state.originalData = null;
        state.error = null;
      }),

    updateField: (path, value) =>
      set((state) => {
        if (state.canvasData) {
          setNestedValue(state.canvasData as unknown as Record<string, unknown>, path, value);
          state.canvasData.isDirty = true;
        }
      }),

    addNextStep: (step) =>
      set((state) => {
        if (state.canvasData) {
          state.canvasData.roadmap.nextSteps.push({
            ...step,
            id: generateId(),
          });
          state.canvasData.isDirty = true;
        }
      }),

    removeNextStep: (stepId) =>
      set((state) => {
        if (state.canvasData) {
          state.canvasData.roadmap.nextSteps = state.canvasData.roadmap.nextSteps.filter(
            (s) => s.id !== stepId
          );
          state.canvasData.isDirty = true;
        }
      }),

    toggleNextStep: (stepId) =>
      set((state) => {
        if (state.canvasData) {
          const step = state.canvasData.roadmap.nextSteps.find((s) => s.id === stepId);
          if (step) {
            step.completed = !step.completed;
            state.canvasData.isDirty = true;
          }
        }
      }),

    addMilestone: (milestone) =>
      set((state) => {
        if (state.canvasData) {
          state.canvasData.roadmap.milestones.push({
            ...milestone,
            id: generateId(),
          });
          state.canvasData.isDirty = true;
        }
      }),

    removeMilestone: (milestoneId) =>
      set((state) => {
        if (state.canvasData) {
          state.canvasData.roadmap.milestones = state.canvasData.roadmap.milestones.filter(
            (m) => m.id !== milestoneId
          );
          state.canvasData.isDirty = true;
        }
      }),

    updateMilestone: (milestoneId, updates) =>
      set((state) => {
        if (state.canvasData) {
          const milestone = state.canvasData.roadmap.milestones.find((m) => m.id === milestoneId);
          if (milestone) {
            Object.assign(milestone, updates);
            state.canvasData.isDirty = true;
          }
        }
      }),

    setActiveCell: (cellId) =>
      set((state) => {
        state.activeCell = cellId;
      }),

    setLoading: (loading) =>
      set((state) => {
        state.isLoading = loading;
      }),

    setSaving: (saving) =>
      set((state) => {
        state.isSaving = saving;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

    resetChanges: () =>
      set((state) => {
        if (state.originalData) {
          state.canvasData = JSON.parse(JSON.stringify(state.originalData));
        }
      }),

    markClean: () =>
      set((state) => {
        if (state.canvasData) {
          state.canvasData.isDirty = false;
          state.canvasData.lastSaved = new Date();
          state.originalData = JSON.parse(JSON.stringify(state.canvasData));
        }
      }),
  }))
);
