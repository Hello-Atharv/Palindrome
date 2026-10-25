import { formatBytes, h } from '../dom';
import type { Ctx, Panel } from './panel';

const YELLOW = 0xffff00;

/**
 * What to do and what to look at for a game, with live readouts: the frame, the score (pong.s lights a 2x2 yellow block per
 * hit; a program that draws its own score shows it on the screen), and the input log, which is the only garbage Pong keeps.
 * Hidden for programs that are not games.
 */
export function gamePanel(): Panel {
  const el = h('section', 'game');
  el.setAttribute('aria-label', 'game notes');
  const note = h('p', 'game-note');
  const stats = h('dl', 'game-stats');
  const stat = (label: string, hint = '') => {
    const dt = h('dt', '', label);
    if (hint) dt.title = hint;
    const dd = h('dd', 'mono');
    stats.append(dt, dd);
    return { dt, dd };
  };
  const frame = stat('Frame', 'frames the game has completed (the FRAME word, SPEC 11.7)');
  const score = stat('Score', 'one yellow block per hit');
  const log = stat('Input log', 'the keys the game had to record: the only garbage it keeps, and it is added to the machine history either way');
  el.append(note, stats);

  let game: unknown;
  return {
    el,
    update({ program, frameNo, snap }: Ctx) {
      const info = program?.game;
      el.hidden = !info;
      if (!info) {
        game = undefined;
        return;
      }
      if (info !== game) {
        game = info;
        note.textContent = info.note;
        score.dt.hidden = score.dd.hidden = !info.blocks;
        log.dt.hidden = log.dd.hidden = !info.log;
      }
      frame.dd.textContent = frameNo === null ? '–' : frameNo.toLocaleString('en-GB');
      if (info.blocks) {
        let n = 0;
        for (const w of snap.fb) if (w === YELLOW) n++;
        score.dd.textContent = `${n / 4} ${n / 4 === 1 ? 'hit' : 'hits'}`;
      }
      if (info.log) log.dd.textContent = frameNo === null ? '–' : `${formatBytes(frameNo * info.log.bytesPerFrame)} (${info.log.bytesPerFrame} bytes a frame)`;
    },
  };
}
