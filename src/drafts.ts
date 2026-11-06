import type { Note } from './storage';
export interface DraftState { notes: Map<string, Note>; activeId?: string }
export type DraftAction = { type: 'edit'; note: Note } | { type: 'select'; id: string } | { type: 'close' } | { type: 'remove'; id: string } | { type: 'pin'; id: string; pinned: boolean };
export function updateDrafts(state: DraftState, action: DraftAction): DraftState {
  if (action.type === 'close') return { ...state, activeId: undefined };
  if (action.type === 'select') return { ...state, activeId: state.notes.has(action.id) ? action.id : undefined };
  const notes = new Map(state.notes);
  if (action.type === 'edit') { notes.set(action.note.id, action.note); return { notes, activeId: action.note.id }; }
  if (action.type === 'pin') { const note = notes.get(action.id); if (note) notes.set(action.id, { ...note, pinned: action.pinned }); return { ...state, notes }; }
  notes.delete(action.id);
  return { notes, activeId: state.activeId === action.id ? undefined : state.activeId };
}
export function isDirty(note: Note, saved?: Note): boolean {
  return !saved || note.title !== saved.title || note.body !== saved.body || note.tag !== saved.tag || (note.images?.length || 0) !== (saved.images?.length || 0) || (note.attachments?.length || 0) !== (saved.attachments?.length || 0) || JSON.stringify(note.images || []) !== JSON.stringify(saved.images || []) || JSON.stringify(note.attachments || []) !== JSON.stringify(saved.attachments || []);
}
