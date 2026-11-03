import { useState } from 'react';
import { supabase } from '../supabase.ts';
import { useCatalogos } from '../datos.ts';
import { Campo, Formulario, MensajeError } from './UI.tsx';
import { useNotificaciones } from './Notificaciones.tsx';
export function UnidadesCatalogo() {
 const { cat, recargar, error }=useCatalogos(true);const {notificar}=useNotificaciones();
 const [nombre,setNombre]=useState(''),[abreviatura,setAbreviatura]=useState('');const [ocupado,setOcupado]=useState(false);
 return <section className="tarjeta"><h2>Unidades de medida</h2><MensajeError texto={error}/>
  <Formulario className="formulario formulario-catalogo" onSubmit={async()=>{
   const {error:e}=await supabase.from('unidades_medida').insert({nombre:nombre.trim(),abreviatura:abreviatura.trim()||null});
   if(e)throw new Error(e.message);setNombre('');setAbreviatura('');notificar('Unidad de medida guardada.','exito');await recargar();
  }}><div className="filtros"><Campo etiqueta="Nombre de la unidad" requerido><input minLength={2} maxLength={80} value={nombre} onChange={e=>setNombre(e.target.value)}/></Campo><Campo etiqueta="Abreviatura" opcional><input maxLength={20} value={abreviatura} onChange={e=>setAbreviatura(e.target.value)}/></Campo><button type="submit" className="boton-primario">Agregar unidad</button></div></Formulario>
  <ul className="lista-catalogo">{cat?.unidades.map(u=><li key={u.id}><div><strong>{u.nombre}</strong><span className="estado-registro">{u.activo?'Activa':'Inactiva'}{u.abreviatura?` · ${u.abreviatura}`:''}</span></div><button type="button" className="boton-silencioso" disabled={ocupado} onClick={async()=>{setOcupado(true);try{const r=await supabase.from('unidades_medida').update({activo:!u.activo}).eq('id',u.id).eq('version',u.version).select('id');if(r.error)throw new Error(r.error.message);if(!r.data?.length)throw new Error('La unidad cambió. Actualiza la lista.');await recargar();notificar(u.activo?'Unidad desactivada.':'Unidad reactivada.','exito');}catch(e){notificar(e instanceof Error?e.message:String(e),'error');}finally{setOcupado(false);}}}>{u.activo?'Desactivar':'Reactivar'}</button></li>)}</ul>
 </section>;
}
