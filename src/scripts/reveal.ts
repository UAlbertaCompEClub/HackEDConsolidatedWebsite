// Runs a callback once an element scrolls into view (or is already above it, e.g. after
// jumping to an anchor). Plain scroll/resize checks instead of IntersectionObserver: there are
// only a handful of elements, and a missed observer callback would leave content hidden.
//
// Components only hide things behind `html.reveal`, which is added here, so if this script
// never loads the page just shows everything.

type Entry = { el: Element; cb: () => void };

const pending: Entry[] = [];
let bound = false;

document.documentElement.classList.add('reveal');

function check() {
  const line = innerHeight * 0.85;
  for (let i = pending.length - 1; i >= 0; i--) {
    const { el, cb } = pending[i];
    if (el.getBoundingClientRect().top < line) {
      pending.splice(i, 1);
      cb();
    }
  }
  if (!pending.length && bound) {
    removeEventListener('scroll', check);
    removeEventListener('resize', check);
    bound = false;
  }
}

export function onReveal(el: Element, cb: () => void) {
  pending.push({ el, cb });
  if (!bound) {
    addEventListener('scroll', check, { passive: true });
    addEventListener('resize', check);
    bound = true;
  }
  check();
}
