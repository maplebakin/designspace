import type { SerializedFabricObject } from '../state/editorStore';

export type CollaboratorCursor = {
  userId: string;
  x: number;
  y: number;
};

export type Collaborator = {
  userId: string;
  name: string;
  color: string;
};

export type CollaborationState = {
  collaborators: Collaborator[];
  cursors: CollaboratorCursor[];
  canvasObjects: SerializedFabricObject[];
};

type CollaborationListener = (state: CollaborationState) => void;

export class CollaborativeEditingManager {
  private listeners = new Set<CollaborationListener>();
  private state: CollaborationState = {
    collaborators: [],
    cursors: [],
    canvasObjects: [],
  };

  connect(sessionId: string): void {
    console.info(`CollaborativeEditingManager connected to session ${sessionId}`);
  }

  disconnect(): void {
    console.info('CollaborativeEditingManager disconnected');
  }

  broadcastState(canvasObjects: SerializedFabricObject[]): void {
    this.state = { ...this.state, canvasObjects: JSON.parse(JSON.stringify(canvasObjects)) };
    this.emit();
  }

  updateCollaborators(collaborators: Collaborator[]): void {
    this.state = { ...this.state, collaborators };
    this.emit();
  }

  updateCursor(cursor: CollaboratorCursor): void {
    const cursors = [...this.state.cursors.filter((entry) => entry.userId !== cursor.userId), cursor];
    this.state = { ...this.state, cursors };
    this.emit();
  }

  subscribe(listener: CollaborationListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): CollaborationState {
    return this.state;
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export const collaborativeEditingManager = new CollaborativeEditingManager();
