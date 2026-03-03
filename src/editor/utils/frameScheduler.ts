/**
 * FrameScheduler - Unified frame cycle for canvas and UI work.
 */

export enum TaskPriority {
  Critical = 0,
  High = 10,
  Normal = 20,
  Low = 30,
  Idle = 40,
  UPDATE_GUIDES = Low,
  UPDATE_LAYERS = High,
  UPDATE_VIEWPORT = Normal,
  CALCULATE_OFFSET = Normal,
  REQUEST_RENDER = Critical,
}

export interface ScheduledTask {
  callback: () => void;
  priority: TaskPriority;
  id: string;
}

export class FrameScheduler {
  private rafId: number | null = null;
  private tasks = new Set<ScheduledTask>();
  private scheduledTasks = new Map<TaskPriority, ScheduledTask[]>();
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Schedule a task to run in the next animation frame
   * Tasks are executed in priority order
   */
  schedule(task: Omit<ScheduledTask, 'id'>): () => void {
    // Generate a unique ID for this task
    const taskId = `${Date.now()}-${Math.random()}`;
    
    const scheduledTask: ScheduledTask = {
      ...task,
      id: taskId,
    };

    this.tasks.add(scheduledTask);

    // Add to priority queue
    if (!this.scheduledTasks.has(task.priority)) {
      this.scheduledTasks.set(task.priority, []);
    }
    this.scheduledTasks.get(task.priority)!.push(scheduledTask);

    // Schedule RAF if not already scheduled
    this.ensureScheduled();

    // Return a function to cancel this specific task
    return () => {
      this.cancelTask(taskId);
    };
  }

  scheduleTask(callback: () => void, priority: TaskPriority = TaskPriority.Normal): () => void {
    return this.schedule({ callback, priority });
  }

  private ensureScheduled(): void {
    if (this.rafId !== null || this.timeoutId !== null) {
      return;
    }

    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => this.flush());
      return;
    }

    this.timeoutId = setTimeout(() => this.flush(), 16);
  }

  private flush(): void {
    // Clear the RAF ID since we're executing now
    this.rafId = null;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Execute all tasks in priority order
    const priorities = Array.from(this.scheduledTasks.keys()).sort((a, b) => a - b);
    
    for (const priority of priorities) {
      const tasks = this.scheduledTasks.get(priority) || [];
      
      // Execute all tasks at this priority level
      for (const task of tasks) {
        try {
          task.callback();
        } catch (error) {
          console.error(`Error executing scheduled task with priority ${priority}:`, error);
        }
        
        // Remove the task from the main set
        this.tasks.delete(task);
      }
      
      // Clear the priority queue for this level
      this.scheduledTasks.delete(priority);
    }
  }

  /**
   * Cancel a specific task by its ID
   */
  private cancelTask(taskId: string): void {
    // Find and remove the task
    for (const task of this.tasks) {
      if (task.id === taskId) {
        this.tasks.delete(task);
        
        // Also remove from priority queues
        for (const [_, taskList] of this.scheduledTasks.entries()) {
          const index = taskList.findIndex(t => t.id === taskId);
          if (index !== -1) {
            taskList.splice(index, 1);
          }
        }
        break;
      }
    }
  }

  /**
   * Cancel all scheduled tasks and cancel the RAF
   */
  cancel(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    this.tasks.clear();
    this.scheduledTasks.clear();
  }

  /**
   * Get the number of scheduled tasks
   */
  getTaskCount(): number {
    return this.tasks.size;
  }

  /**
   * Get tasks by priority level
   */
  getTasksByPriority(priority: TaskPriority): ScheduledTask[] {
    return this.scheduledTasks.get(priority) || [];
  }
}

// Create a singleton instance for the whole application
export const frameScheduler = new FrameScheduler();
