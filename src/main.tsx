import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import { configValida } from './config.ts';
import './estilos.css';

function ConfigFaltante() {
  return (
    <div className="acceso">
      <p className="marca-grande">Compras Semanales Presh Tech</p>
      <h2>Falta la configuración</h2>
      <p>
        El archivo <code>config.js</code> aún tiene los valores de ejemplo.
        Edítalo y escribe la <b>URL del proyecto de Supabase</b> y la
        <b> clave pública (anon)</b>, siguiendo la guía de despliegue
        (<code>docs/GUIA_DESPLIEGUE.md</code>, sección “Configurar config.js”).
      </p>
      <p className="texto-suave">
        Esos dos valores son públicos por diseño. Nunca escribas aquí la clave
        secreta (service_role).
      </p>
    </div>
  );
}

const raiz = document.getElementById('raiz');
if (raiz) {
  ReactDOM.createRoot(raiz).render(
    <React.StrictMode>
      {configValida() ? <App /> : <ConfigFaltante />}
    </React.StrictMode>
  );
}
