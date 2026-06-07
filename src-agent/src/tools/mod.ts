import type { BridgeClient } from '../bridge.js';
import { excelTools } from './excel-tools.js';
import { configTools } from './config-tools.js';
import { promptTools } from './prompt-tools.js';
import { batchTools } from './batch-tools.js';

export function createCustomTools(bridge: BridgeClient) {
  return [
    ...excelTools(bridge),
    ...configTools(bridge),
    ...promptTools(bridge),
    ...batchTools(bridge),
  ];
}

export { excelTools } from './excel-tools.js';
export { configTools } from './config-tools.js';
export { promptTools } from './prompt-tools.js';
export { batchTools } from './batch-tools.js';
