/**
 * FrameScheduler - Unified RAF cycle for all canvas operations
 * Implements Task 3.2: Unified RAF Cycle from the roadmap
 */

export enum TaskPriority {
  UPDATE_GUIDES = 0,
  UPDATE_LAYERS = 10,
  UPDATE_VIEWPORT = 20,
  CALCULATE_OFFSET = 30,
  REQUEST_RENDER = 40,
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
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }

    // Return a function to cancel this specific task
    return () => {
      this.cancelTask(taskId);
    };
  }

  private flush(): void {
    // Clear the RAF ID since we're executing now
    this.rafId = null;

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