import { html, render, useEffect, useReducer, useState } from './vendor/preact-htm.js';
import { state, subscribe, load, activeSession } from './store.js';
import { syncNow } from './sync.js';
import { TrainView } from './views/train.js';
import { SessionView } from './views/session.js';
import { HistoryView } from './views/history.js';
import { TemplatesView, TemplateEditor } from './views/templates.js';
import { ExercisesView, ExerciseDetail } from './views/exercises.js';
import { MoreView } from './views/more.js';

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => { setHash(location.hash || '#/'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    // The hash may have changed before this listener was attached (e.g. auto-resume on start).
    setHash(location.hash || '#/');
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

function route(path) {
  const [, a, b] = path.split('/');
  switch (a) {
    case 'session': return ['train', html`<${SessionView} />`];
    case 'history': return ['train', html`<${HistoryView} key=${b} id=${b} />`];
    case 'templates': return ['templates', b ? html`<${TemplateEditor} key=${b} id=${b} />` : html`<${TemplatesView} />`];
    case 'exercises': return ['exercises', b ? html`<${ExerciseDetail} key=${b} id=${b} />` : html`<${ExercisesView} />`];
    case 'more': return ['more', html`<${MoreView} />`];
    default: return ['train', html`<${TrainView} />`];
  }
}

function Nav({ tab }) {
  const act = activeSession();
  const items = [
    ['train', act ? '#/session' : '#/', act ? 'Workout' : 'Train', '🏋'],
    ['templates', '#/templates', 'Templates', '☰'],
    ['exercises', '#/exercises', 'Exercises', '◎'],
    ['more', '#/more', 'More', '⚙'],
  ];
  return html`<nav class="tabbar">
    ${items.map(([k, href, label, icon]) => html`<a href=${href} class=${tab === k ? 'on' : ''}>
      <span class="ti">${icon}${k === 'train' && act ? html`<i class="live"></i>` : ''}</span><span>${label}</span></a>`)}
  </nav>`;
}

function App() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const off = subscribe(force);
    force(); // catch up on anything emitted before we subscribed (e.g. a fast load())
    return off;
  }, []);
  const path = useHash();
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const on = () => setUpdateReady(true);
    window.addEventListener('sw-update', on);
    return () => window.removeEventListener('sw-update', on);
  }, []);
  if (!state.ready) return html`<div class="splash">Loading…</div>`;
  const [tab, view] = route(path);
  return html`
    ${updateReady && html`<button class="update-toast" onClick=${() => location.reload()}>New version ready. Tap to update.</button>`}
    <main class=${path.startsWith('/session') ? 'in-session' : ''}>${view}</main>
    <${Nav} tab=${tab} />`;
}

render(html`<${App} />`, document.getElementById('app'));
load().then(() => {
  // On cold start with a workout in progress, jump straight back into it.
  if (activeSession() && (location.hash === '' || location.hash === '#/')) location.hash = '#/session';
  syncNow();
}).catch((e) => {
  document.getElementById('app').textContent = 'Could not open local storage: ' + e.message;
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) window.dispatchEvent(new Event('sw-update'));
      });
    });
  }).catch(() => { /* offline support unavailable */ });
}
