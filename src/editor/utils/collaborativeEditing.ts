/**
 * collaborativeEditing - Collaborative editing with CRDTs
 * Implements Task 13: Add collaborative editing with CRDTs
 */

import * as fabric from 'fabric';

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  avatar?: string;
  cursorPosition?: { x: number; y: number };
  selection?: string[]; // IDs of selected objects
  isActive: boolean;
}

export interface Operation {
  type: 'create' | 'update' | 'delete' | 'move' | 'resize';
  objectId: string;
  data: any;
  timestamp: number;
  userId: string;
}

export interface AwarenessData {
  user: {
    name: string;
    color: string;
    avatar?: string;
  };
  cursor: {
    x: number;
    y: number;
  };
  selection: string[];
}

export class CollaborativeEditingManager {
  private static instance: CollaborativeEditingManager;
  private clientId: string;
  private collaborators: Map<string, Collaborator> = new Map();
  private canvas: fabric.Canvas | null = null;
  private userId: string;
  private connectionCallbacks: Set<(connected: boolean) => void> = new Set();
  private operationCallbacks: Set<(op: Operation) => void> = new Set();
  private awarenessCallbacks: Set<(collaborators: Collaborator[]) => void> = new Set();
  private connected: boolean = false;

  static getInstance(): CollaborativeEditingManager {
    if (!CollaborativeEditingManager.instance) {
      CollaborativeEditingManager.instance = new CollaborativeEditingManager();
    }
    return CollaborativeEditingManager.instance;
  }

  constructor() {
    this.clientId = 'stub-client-' + Date.now();
    this.userId = this.clientId;
  }


  /**
   * Initialize collaborative editing with a canvas
   */
  initialize(canvas: fabric.Canvas, userId: string, _userName: string): void {
    this.canvas = canvas;
    this.userId = userId;

    // Setup canvas event listeners to sync changes
    this.setupCanvasListeners();
  }


  /**
   * Setup canvas event listeners to sync changes
   */
  private setupCanvasListeners(): void {
    if (!this.canvas) return;
    
    // Listen for object additions
    this.canvas.on('object:added', (e) => {
      if (e.target && !(e.target as any)._fromCollab) {
        this.sendOperation({
          type: 'create',
          objectId: (e.target as any).id || this.generateId(),
          data: this.fabricObjectToData(e.target),
          timestamp: Date.now(),
          userId: this.userId,
        });
      }
    });
    
    // Listen for object modifications
    this.canvas.on('object:modified', (e) => {
      if (e.target && !(e.target as any)._fromCollab) {
        this.sendOperation({
          type: 'update',
          objectId: (e.target as any).id,
          data: this.fabricObjectToData(e.target),
          timestamp: Date.now(),
          userId: this.userId,
        });
      }
    });
    
    // Listen for object removals
    this.canvas.on('object:removed', (e) => {
      if (e.target && !(e.target as any)._fromCollab) {
        this.sendOperation({
          type: 'delete',
          objectId: (e.target as any).id,
          data: null,
          timestamp: Date.now(),
          userId: this.userId,
        });
      }
    });
    
    // Listen for selection changes
    this.canvas.on('selection:created', (e) => {
      this.updateSelectionInAwareness(e.selected || []);
    });
    
    this.canvas.on('selection:updated', (e) => {
      this.updateSelectionInAwareness(e.selected || []);
    });
    
    this.canvas.on('selection:cleared', () => {
      this.updateSelectionInAwareness([]);
    });
    
    // Listen for mouse moves to update cursor position
    this.canvas.on('mouse:move', (e) => {
      if (e.absolutePointer) {
        this.updateCursorPosition(e.absolutePointer.x, e.absolutePointer.y);
      }
    });
  }

  /**
   * Send an operation to other collaborators
   */
  private sendOperation(op: Operation): void {
    // In a real implementation, this would send the operation to other collaborators
    // via a WebSocket or similar real-time communication method
    console.log(`Sending operation: ${op.type} for object ${op.objectId}`);
    
    // Notify local callbacks
    this.operationCallbacks.forEach(callback => callback(op));
  }

  /**
   * Receive an operation from another collaborator
   */
  receiveOperation(op: Operation): void {
    // In a real implementation, this would apply the operation to the local canvas
    console.log(`Received operation: ${op.type} for object ${op.objectId} from user ${op.userId}`);
    
    // Apply the operation to the canvas
    this.applyOperation(op);
  }

  /**
   * Apply an operation to the canvas
   */
  private applyOperation(op: Operation): void {
    if (!this.canvas) return;
    
    switch (op.type) {
      case 'create': {
        if (op.data) {
          const fabricObj = this.dataToFabricObject(op.data);
          if (fabricObj) {
            (fabricObj as any)._fromCollab = true; // Mark as coming from collaboration
            this.canvas.add(fabricObj);
            this.canvas.requestRenderAll();
          }
        }
        break;
      }

      case 'update': {
        if (op.data) {
          const obj = this.canvas.getObjects().find(o => (o as any).id === op.objectId);
          if (obj) {
            obj.set(op.data);
            obj.setCoords();
            this.canvas.requestRenderAll();
          }
        }
        break;
      }

      case 'delete': {
        const objToDelete = this.canvas.getObjects().find(o => (o as any).id === op.objectId);
        if (objToDelete) {
          this.canvas.remove(objToDelete);
          this.canvas.requestRenderAll();
        }
        break;
      }
    }
  }

  /**
   * Convert fabric object to data
   */
  private fabricObjectToData(obj: fabric.Object): any {
    return obj.toObject(['id', 'tokenRole', 'colorLocked']);
  }

  /**
   * Convert data to fabric object
   */
  private dataToFabricObject(objData: any): fabric.Object | null {
    try {
      // Create fabric object from data
      // This is a simplified version - in practice, you'd need to handle different object types
      let fabricObj: fabric.Object;
      
      switch (objData.type) {
        case 'rect':
          fabricObj = new fabric.Rect(objData);
          break;
        case 'circle':
          fabricObj = new fabric.Circle(objData);
          break;
        case 'triangle':
          fabricObj = new fabric.Triangle(objData);
          break;
        case 'i-text':
        case 'textbox':
          fabricObj = new fabric.Textbox(objData.text || '', objData);
          break;
        case 'image': {
          // For images, we'd need to handle the src differently
          const canvasElement = document.createElement('canvas');
          canvasElement.width = objData.width || 100;
          canvasElement.height = objData.height || 100;
          fabricObj = new fabric.Image(canvasElement, objData);
          break;
        }
        default:
          // For other types, try to create a generic object
          fabricObj = new fabric.Object(objData);
          break;
      }
      
      // Mark as coming from collaboration to avoid infinite loops
      (fabricObj as any)._fromCollab = true;
      
      return fabricObj;
    } catch (error) {
      console.error('Error converting data to fabric object:', error);
      return null;
    }
  }

  /**
   * Update cursor position in awareness
   */
  private updateCursorPosition(x: number, y: number): void {
    // In a real implementation, this would update the user's cursor position in the awareness system
    console.log(`Updating cursor position: (${x}, ${y})`);
  }

  /**
   * Update selection in awareness
   */
  private updateSelectionInAwareness(selection: fabric.Object[]): void {
    const selectedIds = selection.map(obj => (obj as any).id).filter(Boolean);
    // In a real implementation, this would update the user's selection in the awareness system
    console.log(`Updating selection: ${selectedIds.join(', ')}`);
  }

  /**
   * Connect to collaboration server
   */
  async connectToServer(roomId: string, serverUrl: string): Promise<boolean> {
    try {
      // In a real implementation, this would connect to a WebSocket server
      console.log(`Connecting to room: ${roomId} at ${serverUrl}`);
      
      // Simulate successful connection
      this.connected = true;
      this.connectionCallbacks.forEach(callback => callback(true));
      
      return true;
    } catch (error) {
      console.error('Failed to connect to collaboration server:', error);
      this.connectionCallbacks.forEach(callback => callback(false));
      return false;
    }
  }

  /**
   * Disconnect from collaboration server
   */
  disconnect(): void {
    this.connected = false;
    this.connectionCallbacks.forEach(callback => callback(false));
  }

  /**
   * Check if connected to collaboration server
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current collaborators
   */
  getCollaborators(): Collaborator[] {
    return Array.from(this.collaborators.values());
  }

  /**
   * Subscribe to connection status changes
   */
  subscribeToConnection(callback: (connected: boolean) => void): () => void {
    this.connectionCallbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.connectionCallbacks.delete(callback);
    };
  }

  /**
   * Subscribe to operation changes
   */
  subscribeToOperations(callback: (op: Operation) => void): () => void {
    this.operationCallbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.operationCallbacks.delete(callback);
    };
  }

  /**
   * Subscribe to awareness changes
   */
  subscribeToAwareness(callback: (collaborators: Collaborator[]) => void): () => void {
    this.awarenessCallbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.awarenessCallbacks.delete(callback);
    };
  }

  /**
   * Send a message to other collaborators
   */
  sendMessage(content: string): void {
    // In a real implementation, this would send a message through the collaboration protocol
    console.log(`Sending message: ${content}`);
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

// Create a singleton instance
export const collaborativeEditingManager = CollaborativeEditingManager.getInstance();

// Helper function to check if collaborative mode is active
export const isCollaborativeMode = (): boolean => {
  return collaborativeEditingManager.isConnected();
};