// Public API exports

// Core types
export * from './core/types/primitives';

// Entity FSM
export { transitionEntity, applyEntityTx, generateTransferMessages } from './core/entity/fsm';

// Server processing
export { processBlock } from './core/server/processBlock';

// Storage
export { KV, MemoryKV } from './storage/kvMemory';
export { Storage, StateStorage, WalStorage, BlockStorage, ArchiveStorage } from './storage/interfaces';
export { createStorage } from './storage/implementations';

// Utils
export { 
  PipelineContext, PipelineStep, ErrorCollector, ErrorSeverity, 
  createPipeline 
} from './utils/pipeline';