import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import { configValida, motivoConfigInvalida, ENTORNO } from './config.ts';
import './estilos.css';

function ConfigFaltante() {
  return (
    <div className="acceso">
      <p className="marca-grande">Compras Semanales Presh Tech</p>
      <h2>{ENTORNO === 'pruebas' ? 'Vista previa sin proyecto de pruebas' : 'Falta la configuración'}</h2>
      <p>{motivoConfigInvalida()}</p>
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
