import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Portal } from './portal';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');
createRoot(rootEl).render(<StrictMode><Portal /></StrictMode>);
