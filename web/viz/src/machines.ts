import type { RVM } from '../../../spec/vm_api';

/** One machine under the shell. Every action is applied to all of them, so they share one clock (Compare view). */
export interface Machine {
  label: string;
  vm: RVM;
}
