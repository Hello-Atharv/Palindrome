/** web/mock_vm public surface. The UI imports only `createMockVm` (a `CreateVm`) from here. */
import type { CreateVm } from '../../../spec/vm_api';
import { LoggingVm } from './logging_vm';

export const createMockVm: CreateVm = (kind) => {
  if (kind !== 'logging') throw new Error('mock_vm only implements the logging VM');
  return new LoggingVm();
};

export { LoggingVm } from './logging_vm';
export { SAMPLES, ifElse, countingLoop, callReturn, gradient } from './programs';
export type { Sample } from './programs';
export { ProgramBuilder } from './builder';
export { buildImage, parseImage } from './image';
export { encode, decode, MNEMONIC } from './isa';
