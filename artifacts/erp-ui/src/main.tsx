import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { setAuthTokenGetter } from '@workspace/api-client-react';

setAuthTokenGetter(() => localStorage.getItem('sl-erp-token'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);