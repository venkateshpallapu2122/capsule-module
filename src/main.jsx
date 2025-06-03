import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx'; // This will be our main component
import './index.css'; // Our new Tailwind CSS file

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);