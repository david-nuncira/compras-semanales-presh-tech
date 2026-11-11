// Ayuda corta al inicio de cada pantalla principal: qué se hace aquí, en pasos numerados.
// Se puede cerrar; la elección se recuerda en este navegador (solo es una comodidad).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PANTALLAS } from '../util/guias.ts';
import { Icono } from './UI.tsx';

const clave = (k: string) => `ayuda-pantalla:${k}`;
function leer(k: string): boolean {
  try { return window.localStorage.getItem(clave(k)) !== 'cerrada'; } catch { return true; }
}
function guardar(k: string, abierta: boolean) {
  try { window.localStorage.setItem(clave(k), abierta ? 'abierta' : 'cerrada'); } catch { /* sin almacenamiento: no pasa nada */ }
}

export function PasoAPaso({ pantalla }: { pantalla: keyof typeof PANTALLAS }) {
  const datos = PANTALLAS[pantalla];
  const [abierta, setAbierta] = useState(() => leer(pantalla));
  if (!datos) return null;
  return (
    <details className="paso-a-paso" open={abierta}
      onToggle={(e) => { const v = (e.currentTarget as HTMLDetailsElement).open; if (v !== abierta) { setAbierta(v); guardar(pantalla, v); } }}>
      <summary><Icono nombre="info" /> {datos.titulo}</summary>
      <ol>{datos.pasos.map((p) => <li key={p}>{p}</li>)}</ol>
      <p><Link to="/ayuda">Ver la guía paso a paso completa →</Link></p>
    </details>
  );
}
