import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/base.css';
import './options.css';
import { OptionsApp } from './OptionsApp';

const container = document.getElementById('root');
if (!container) throw new Error('Options root element is missing.');

createRoot(container).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>,
);