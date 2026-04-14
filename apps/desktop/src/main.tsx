// DSGVO: Local font imports — NO external CDN
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// Initialise all modules (registers Event Bus listeners)
import { init as initNotes } from './modules/notes';
import { init as initTasks } from './modules/tasks';
import { init as initCalendar } from './modules/calendar';
import { init as initTimeTracker } from './modules/time-tracker';

initNotes();
initTasks();
initCalendar();
initTimeTracker();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
