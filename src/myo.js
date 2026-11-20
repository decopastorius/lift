// Myo-rep guidance (activation set + mini-sets).
// Protocol: activation set close to failure, then mini-sets of ~1/3 of the
// activation reps (3–5) after 3–5 deep breaths (~15 s). Stop when a mini-set
// falls short of the target, or after the maximum number of mini-sets.
import { SET, isLogged } from './progression.js';

export const MYO_MAX_MINIS = 5;

export function miniTarget(activationReps) {
  return Math.min(5, Math.max(3, Math.round((activationReps || 0) / 3)));
}

/** Sets belonging to one myo block, in order. */
export function blockSets(sets, block) {
  return sets.filter((s) => (s.type === SET.MYO_ACT || s.type === SET.MYO_MINI) && (s.block || 0) === block);
}

/**
 * What to do next in a myo block.
 * @returns {{phase:'activation'|'mini'|'done', target?:number, index?:number, total?:string, message:string}}
 */
export function myoNext(sets, maxMinis = MYO_MAX_MINIS) {
  const act = sets.find((s) => s.type === SET.MYO_ACT);
  if (!act || !isLogged(act)) {
    return { phase: 'activation', message: 'Activation set: go to 1–2 reps in reserve.' };
  }
  const target = miniTarget(act.reps);
  const minis = sets.filter((s) => s.type === SET.MYO_MINI && isLogged(s));
  const total = [act.reps, ...minis.map((s) => s.reps)].join('+');
  const lastMini = minis[minis.length - 1];
  if (act.myoEnded) return { phase: 'done', target, total, message: `Myo-rep set ended: ${total}` };
  if (lastMini && lastMini.reps < target) {
    return { phase: 'done', target, total, message: `Missed ${target} reps, set complete: ${total}` };
  }
  if (minis.length >= maxMinis) {
    return { phase: 'done', target, total, message: `${maxMinis} mini-sets done: ${total}` };
  }
  return {
    phase: 'mini', target, total, index: minis.length + 1,
    message: `Mini-set ${minis.length + 1}: ${target} reps after 3–5 deep breaths`,
  };
}
