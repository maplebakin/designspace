export type CollaborationSession = {
  id: string;
  projectId: string;
  participants: Array<{
    userId: string;
    name: string;
    color: string;
  }>;
};

export type CollaborationDelta = {
  sessionId: string;
  projectId: string;
  actorId: string;
  operations: Array<{
    type: 'add' | 'update' | 'remove';
    objectId: string;
    payload?: Record<string, unknown>;
  }>;
  createdAt: string;
};
