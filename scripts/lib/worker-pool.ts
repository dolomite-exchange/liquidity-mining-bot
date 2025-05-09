import * as os from 'node:os';
import { Worker } from 'worker_threads';

// Worker Pool Class
class WorkerPool {
  private workers: Worker[];
  private tasks: any[];
  private maxWorkers: number;
  private activeWorkers: number;

  constructor(maxWorkers: number) {
    this.maxWorkers = maxWorkers;
    this.workers = [];
    this.tasks = [];
    this.activeWorkers = 0;
  }

  private createWorker() {
    const worker = new Worker(`${__dirname}/worker.js`);

    worker.on('error', (err) => console.error('Worker Error:', err));
    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Worker exited with code ${code}`);
      }
      this.activeWorkers--;
      this.processNextTask();
    });

    this.workers.push(worker);
    return worker;
  }

  public addTask(data: any): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (this.activeWorkers < this.maxWorkers) {
        this.activeWorkers++;
        const worker = this.createWorker();
        worker.on('message', (result) => resolve(result));
        worker.on('error', (err) => reject(err));

        // Send the task data to the worker
        worker.postMessage(data);
      } else {
        // Queue the task if all workers are busy
        this.tasks.push(data);
      }
    });
  }

  private processNextTask() {
    if (this.tasks.length > 0 && this.activeWorkers < this.maxWorkers) {
      const nextTask = this.tasks.shift();
      if (nextTask) {
        this.addTask(nextTask);
      }
    }
  }
}

// Initialize the Worker Pool
export const WORKER_POOL = new WorkerPool(os.cpus().length);
