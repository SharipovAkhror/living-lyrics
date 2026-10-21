import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/instruments.css';
import './ui/glass/glass.css';
import './styles/phone.css';
import { installPhoneBudget } from './ui/phone';
import { App } from './app/App';

installPhoneBudget();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
