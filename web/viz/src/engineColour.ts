import type { VmKind } from '../../../spec/vm_api';

/**
 * One colour per engine, the same everywhere: the engine switch, the strip under the header, the debug bar and the Compare cards and
 * chart. The shell publishes them as the CSS variables --engine-diary and --engine-rev, so the stylesheet and the script cannot disagree.
 * They are not the time colours (amber, cyan, violet), which keep their meaning.
 */
export const ENGINE_COLOUR: Record<VmKind, string> = { logging: '#8fa8ff', reversible: '#3fb950' };
