import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('operations-root');
if (!root) throw new Error('Operations Hub root element is missing');

createRoot(root).render(<StrictMode><App /></StrictMode>);
