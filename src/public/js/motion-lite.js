// Minimal, dependency-free replacement for the one Motion feature the login
// screen used. Built on the browser's Web Animations API so the portal works
// with no internet and no extra download.
//
//   import { animate } from '/js/motion-lite.js';
//   animate(el, { x: [0, 120], opacity: [0, 1] }, { duration: 0.6, ease: [0.22, 1, 0.36, 1] });
//   animate(el, { scale: [1, 0.97, 1] }, { duration: 0.25, ease: 'easeInOut' })
//     .finished.then(() => { ... });
//
// Supported keyframes: x, y, rotate, scale, opacity (number or number[]).
// Supported options: duration (seconds), delay (seconds), ease (array or name).

const EASINGS = {
  linear: 'linear',
  ease: 'ease',
  easeIn: 'ease-in',
  easeOut: 'ease-out',
  easeInOut: 'ease-in-out',
  circOut: 'cubic-bezier(0.075, 0.82, 0.165, 1)'
};

function easingFor(ease) {
  if (Array.isArray(ease)) return `cubic-bezier(${ease.join(',')})`;
  if (typeof ease === 'string' && EASINGS[ease]) return EASINGS[ease];
  return 'ease';
}

function resolveTarget(target) {
  if (typeof target === 'string') return Array.from(document.querySelectorAll(target));
  if (target && typeof target.length === 'number' && !target.nodeType) return Array.from(target);
  return target ? [target] : [];
}

const TRANSFORM_PROPS = ['x', 'y', 'rotate', 'scale'];
const ALL_PROPS = TRANSFORM_PROPS.concat('opacity');

function frameAt(keyframes, index) {
  const parts = [];
  for (const prop of TRANSFORM_PROPS) {
    if (keyframes[prop] === undefined) continue;
    const values = Array.isArray(keyframes[prop]) ? keyframes[prop] : [keyframes[prop]];
    const value = values[Math.min(index, values.length - 1)];
    if (prop === 'x') parts.push(`translateX(${value}px)`);
    else if (prop === 'y') parts.push(`translateY(${value}px)`);
    else if (prop === 'rotate') parts.push(`rotate(${value}deg)`);
    else if (prop === 'scale') parts.push(`scale(${value})`);
  }

  const frame = {};
  if (parts.length) frame.transform = parts.join(' ');
  if (keyframes.opacity !== undefined) {
    const values = Array.isArray(keyframes.opacity) ? keyframes.opacity : [keyframes.opacity];
    frame.opacity = values[Math.min(index, values.length - 1)];
  }
  return frame;
}

export function animate(target, keyframes, options = {}) {
  const elements = resolveTarget(target);
  const longest = Math.max(
    1,
    ...ALL_PROPS.map((prop) => {
      const value = keyframes[prop];
      return Array.isArray(value) ? value.length : value === undefined ? 0 : 1;
    })
  );

  const frames = Array.from({ length: longest }, (_, index) => frameAt(keyframes, index));
  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const timing = {
    duration: reduceMotion ? 0 : Math.max(0, Number(options.duration ?? 0.3) * 1000),
    delay: reduceMotion ? 0 : Math.max(0, Number(options.delay ?? 0) * 1000),
    easing: easingFor(options.ease),
    fill: 'both'
  };

  const animations = elements.map((el) => el.animate(frames, timing));
  return {
    finished: Promise.all(animations.map((animation) => animation.finished))
  };
}

export default { animate };
