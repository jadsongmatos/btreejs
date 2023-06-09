import { promises as fs } from "fs";
import fetch from "make-fetch-happen";
import Queue = require("better-queue");
const SqliteStore = require("better-queue-sqlite");

// Configure the SQLite store for the queue
const store = new SqliteStore({
  type: "sql",
  dialect: "sqlite",
  path: "/tmp/queue.db.sqlite",
});

// Create a new queue with a custom asyncWorker function
const q: Queue = new Queue(asyncWorker, {
  concurrent: 50,
  store: store,
  maxRetries: 3,
  retryDelay: 1000,
});

async function main() {
  let i = 0;
  const maxCEP = 99999999;
  let succeeded = 0;
  let failed = 0;

  // Enqueue a batch of tasks to the queue
  function enqueueNextBatch(batchSize: number) {
    const initial = i;
    const limit = Math.min(initial + batchSize, maxCEP + 1);
    for (; i < limit; i++) {
      q.push(i);
    }
    return i === maxCEP + 1;
  }

  // Listen to the queue events for task completion
  q.on("task_finish", function (taskId: any, result: any, stats: any) {
    succeeded++;
    if (
      q.getStats().total - failed - succeeded < 100 &&
      !enqueueNextBatch(100)
    ) {
      if (succeeded % 100 == 0) {
        console.log("task_finish| succeeded,i,failed", succeeded, i, failed);
      }
    }
  });

  // Listen to the queue events for task failure
  q.on("task_failed", function (taskId: any, err: any, stats: any) {
    console.log("task_failed", taskId, err, stats);
    failed++;
  });

  // Start by enqueuing the first batch of tasks
  enqueueNextBatch(100);
}

// Call the main function to start the script
main();

// Define the asyncWorker function for processing individual tasks
async function asyncWorker(cep: string, cb: any) {
  try {
    // Fetch information for the given zip code from the API endpoint
    const response = await fetch(
      `https://brasil-search.vercel.app/api/cep/${cep}`,
      {
        retry: {
          maxTimeout: 5000,
        },
        cache: "no-cache", // forces a conditional request
      }
    );

    if (response.status == 200) {
      try {
        const body = await response.json();

        if (body?.type) {
          cb(null, null);
        } else {
          try {
            // Create a buffer with 4 bytes (1 unsigned 32-bit integer)
            const buffer = Buffer.alloc(4);
            // Write an unsigned 32-bit integer to the buffer at position 0
            buffer.writeUInt32LE(parseInt(body.cep, 10), 0);
            await fs.appendFile("/tmp/ceps.bin", buffer);
            console.log(body.cep);
          } catch (error) {
            console.log("catch writeFile:", error, cep);
            cb(error);
          }
        }
        cb(null, null);
      } catch (err) {
        console.log("catch json:", err, cep);
        cb(err);
      }
    } else {
      cb(response.statusText);
    }
  } catch (er) {
    console.log("catch fetch:", er, cep);
    cb(er);
  }
}
