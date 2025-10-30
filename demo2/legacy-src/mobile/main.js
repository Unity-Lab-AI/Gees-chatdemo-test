import './style.css';
import { boot } from './app.js';

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
