import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/fraunces/wght.css';
import './base.css';
import './app.css';
import App from './App.jsx';
// Last, so the calm design layer wins over the feature stylesheets the pages import.
import './calm.css';
// Sidebar + one wide frame for every page, tabs, side-by-side panels.
import './workspace.css';

createRoot(document.getElementById('root')).render(<App />);
