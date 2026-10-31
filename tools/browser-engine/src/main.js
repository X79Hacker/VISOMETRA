export function createWorker(){return new Worker(new URL('./segment.worker.js',import.meta.url),{type:'module'});}
