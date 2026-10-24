/**
 * Public surface of web/viz. The debugger mounts into the shell like this:
 *
 *   import { mountViz } from '../../viz/src';
 *   const viz = mountViz(document.getElementById('app')!, vm, { programs });
 *   viz.slots.timeline.append(myScrubber);           // full-width strip under the toolbar
 *   viz.slots.toolbar.append(myDirectionToggle);     // right of the transport buttons
 *   viz.slots.side.append(myBreakpointList);         // bottom of the right column
 *   viz.on('update', ({ snap, prev }) => ...);       // after every redraw
 *   vm.runTo(500); viz.refresh();                    // after driving the VM yourself
 */
import './style.css';

export { mountViz } from './shell';
export type { BuiltinControls, Machine, UpdateEvent, VizEvents, VizHandle, VizOptions, VizSlots } from './shell';
export type { LineClick, ListingApi } from './panels/listing';
export type { ProgramEntry, ProgramInfo } from './program';
export type { Snapshot } from './snapshot';
export { changedRegs, changedWords } from './snapshot';
export { disassemble } from './disasm';
export type { Disasm } from './disasm';
export { KEY_UP_FLAG, keyCode } from './keys';
