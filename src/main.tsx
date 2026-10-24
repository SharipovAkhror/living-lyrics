import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/instruments.css';
import './ui/glass/glass.css';
import './styles/phone.css';
import { installPhoneBudget } from './ui/phone';
import { setMotionScale } from './ui/spring';
import { installMutations } from './app/mutate';
import { App } from './app/App';

installPhoneBudget();
installMutations();

// Recording only. Springs follow `slowmo`. WebKit has no CDP playback rate,
// so `anims` slows CSS animations the same way. Chromium recordings use CDP
// for CSS and leave this loop off, or the two rates would stack.
const slowQuery = new URLSearchParams(location.search);
const slowmo = Number(slowQuery.get('slowmo'));
if (Number.isFinite(slowmo) && slowmo > 1) {
  setMotionScale(slowmo);
  const anims = Number(slowQuery.get('anims'));
  if (Number.isFinite(anims) && anims > 1) {
    const rate = 1 / slowmo;
    const tick = () => {
      const list = document.getAnimations();
      for (let i = 0; i < list.length; i++) {
        if (list[i].playbackRate !== rate) list[i].playbackRate = rate;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
