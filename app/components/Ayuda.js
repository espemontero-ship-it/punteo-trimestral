'use client';

import { useState } from 'react';

const SECCIONES_ADMIN = [
  {
    titulo: 'Entrar', cuerpo: (
      <p>En la pantalla de acceso, <strong>deja el campo de usuario en blanco</strong> y escribe solo la contraseña de administración. El campo de usuario es únicamente para colaboradores.</p>
    ),
  },
  {
    titulo: 'Inicio', cuando: 'Tienes un ticket o factura suelta en el momento — por ejemplo, acabas de pagar algo con tarjeta.', cuerpo: (
      <p>Es el atajo rápido para subir una factura sin entrar en Movimientos. Hazle una foto o adjunta el PDF y se guarda; más adelante se empareja sola con su línea del banco cuando aparezca.</p>
    ),
  },
  {
    titulo: 'Movimientos', cuando: 'Al empezar el trimestre, y cada vez que resuelves facturas pendientes.', cuerpo: (
      <>
        <p>Es la tabla central: una fila por cada línea del banco. El trabajo del trimestre consiste en dejar cada línea en un estado resuelto.</p>
        <h4>Traer los datos</h4>
        <ul>
          <li><strong>Excel</strong> — sube el extracto del banco (bbva, openbank o paypal). Si es el combinado de las tres pestañas, deja "Detectar automáticamente".</li>
          <li><strong>LarpManager</strong> — sube el CSV de pagos exportado de LarpManager, solo se usan las filas de transferencia (Wire), cruzan por nombre contra ingresos sin resolver.</li>
        </ul>
        <h4>Qué significa cada estado de una línea</h4>
        <TablaEstados filas={[
          ['pendiente', 'Todavía no se ha hecho nada con esta línea.'],
          ['pedida', 'Ya se pidió la factura a quien corresponda, en espera de recibirla.'],
          ['factura futura', 'El proveedor no emite factura hasta que pasa el servicio (ej. vuelos, hoteles) — queda pendiente de pedir mientras el proyecto siga abierto.'],
          ['ignorar', 'No necesita factura ni seguimiento (ej. comisiones bancarias).'],
          ['devolución', 'Es un ingreso — ticket, anticipo o devolución de un jugador — no un gasto con factura.'],
          ['resuelta', 'Ya tiene su factura vinculada. Se puede revertir a mano si hace falta.'],
        ]} />
        <h4>Sugerencias en negrita</h4>
        <p>Cuando el sistema reconoce un proveedor o proyecto ya visto antes, aparece un texto en negrita de color como <span className="chip-sugerencia" style={{ display: 'inline', cursor: 'default' }}>Aplicar: Wield 2</span>. Un toque lo aplica a esa línea; si no es lo que corresponde, se cambia a mano en el desplegable de al lado sin problema.</p>
        <h4>Agrupar por proveedor</h4>
        <p>Las líneas del mismo proveedor se agrupan en una sola cabecera — así una decisión resuelve varias líneas de golpe en vez de una a una. Un grupo de una única línea no lleva cabecera, es una fila más.</p>
        <p>Los iconos pequeños de esa columna sirven para corregir un agrupado que no encaja: <strong>−</strong> saca una línea suelta de su grupo, <strong>+</strong> la une a mano a otro grupo.</p>
        <h4>Buscar, filtrar y ordenar</h4>
        <p>La barra sobre la tabla trae buscador de texto libre, filtro por fechas, el interruptor "Solo pendientes" para ocultar lo ya resuelto, y "Columnas" para mostrar campos extra del excel original que no aparecen por defecto.</p>
        <h4>Cerrar el trimestre</h4>
        <p><strong>Enviar a gestoría</strong> genera el envío final una vez todo está resuelto.</p>
      </>
    ),
  },
  {
    titulo: 'Facturas', cuando: 'Para revisar de un vistazo todas las facturas subidas por cualquier vía (Inicio, Movimientos, o un colaborador) y comprobar que cada una tiene su línea del banco.', cuerpo: (
      <p>Cada fila es una factura: quién la subió y cuándo, y en la columna <strong>Vincular</strong> un botón para buscarle automáticamente su línea del banco, o elegirla a mano si la búsqueda no encuentra nada.</p>
    ),
  },
  {
    titulo: 'Proyectos', cuando: 'Para dar de alta un proyecto nuevo, o revisar los pendientes de cierre de uno concreto.', cuerpo: (
      <>
        <p><strong>+ Añadir proyecto</strong> crea uno con solo su nombre — se reutiliza entre trimestres, y luego se puede asignar a cualquier línea del banco o colaborador.</p>
        <p>Al entrar en un proyecto se ven sus tres listas de pendientes de cierre: devoluciones a jugadores, facturas futuras sin recuperar todavía, y facturas de colaboradores de ese proyecto sin revisar o sin cerrar.</p>
      </>
    ),
  },
  {
    titulo: 'Colaboradores', cuando: 'Alguien va a gestionar gastos de un proyecto, o necesita subir facturas pagadas por NOL directamente.', cuerpo: (
      <>
        <p><strong>+ Añadir colaborador</strong> pide nombre, correo, un proyecto (opcional) y si además puede subir facturas de NOL — son dos cosas independientes, no una elección: alguien puede tener proyecto y ese permiso a la vez, o solo uno de los dos.</p>
        <div className="resumen-mini" style={{ display: 'block' }}>
          Si el correo ya existe en el sistema, no se manda ninguna contraseña nueva — simplemente se le añade el proyecto o el permiso a su cuenta. Solo se manda invitación por correo la primera vez.
        </div>
        <p>Desde la tabla se puede cambiar su estado (activo/inactivo) y sus permisos en cualquier momento. Al tocar su nombre se entra a ver sus cuentas: qué ha subido, qué está aceptado o rechazado, y los pagos hechos.</p>
      </>
    ),
  },
];

const SECCIONES_COLABORADORES = [
  {
    titulo: 'Entrar', cuerpo: (
      <p>Usa el correo y la contraseña que elegiste al aceptar la invitación. Si no la recuerdas, usa "¿Olvidaste tu contraseña?" en la pantalla de acceso.</p>
    ),
  },
  {
    titulo: 'Si estás en más de un proyecto', cuerpo: (
      <p>Al entrar verás la lista de proyectos en los que colaboras, con el total ya subido en cada uno. Toca el que quieras abrir. Si solo tienes uno, se abre directamente.</p>
    ),
  },
  {
    titulo: 'Datos para pedir la factura', cuerpo: (
      <>
        <p>Cuando pidas una factura a un proveedor, tiene que ir a nombre de la asociación, nunca al tuyo — sin eso no se puede pagar por razones legales:</p>
        <div className="resumen-mini" style={{ display: 'block' }}>
          <strong>NotOnlyLarp</strong><br />
          G87705794<br />
          Josué Lillo 10, 1º B<br />
          28053 Madrid
        </div>
      </>
    ),
  },
  {
    titulo: 'Subir una factura', cuerpo: (
      <>
        <p>Adjunta el PDF o hazle una foto desde el móvil, con su fecha, concepto e importe. Se sube a la cuenta del proyecto que tienes abierto y queda pendiente de revisión.</p>
        <p className="muted">Si administración te ha dado el permiso de NOL, en el mismo formulario aparecen además "Quién paga" (marcado "Yo" por defecto) y "Proyecto" — para registrar una factura pagada por NOL directamente, o una tuya de otro proyecto distinto al que tienes abierto.</p>
      </>
    ),
  },
  {
    titulo: 'Tus cuentas', cuerpo: (
      <>
        <p>La tabla de abajo muestra cada factura que has subido y en qué punto está:</p>
        <TablaEstados filas={[
          ['Sin revisar', 'Subida, todavía no comprobada por administración.'],
          ['Aceptada', 'Revisada y correcta, en proceso de pago.'],
          ['Rechazada', 'Hay un problema — el motivo aparece junto a la factura.'],
          ['Cerrada', 'Pagada y cerrada, con su fecha de cierre.'],
        ]} />
        <p>La columna Pagos muestra lo que ya se te ha ingresado, y Pendiente lo que todavía falta por recibir.</p>
      </>
    ),
  },
  {
    titulo: 'Invitar a alguien más', cuando: 'Solo visible si administración te ha dado permiso para este proyecto.', cuerpo: (
      <p>Con nombre y correo, le llega una invitación para que elija su propia contraseña y se una al mismo proyecto.</p>
    ),
  },
];

function TablaEstados({ filas }) {
  return (
    <div className="tabla-estados-ayuda">
      {filas.map(([nombre, texto]) => (
        <div key={nombre} className="tabla-estados-ayuda-fila">
          <strong>{nombre}</strong>
          <span className="muted">{texto}</span>
        </div>
      ))}
    </div>
  );
}

export default function Ayuda() {
  const [version, setVersion] = useState('admin');
  const secciones = version === 'admin' ? SECCIONES_ADMIN : SECCIONES_COLABORADORES;

  return (
    <div>
      <div className="interruptor-ayuda">
        <button type="button" className={version === 'admin' ? 'activa' : ''} onClick={() => setVersion('admin')}>Administración</button>
        <button type="button" className={version === 'colaboradores' ? 'activa' : ''} onClick={() => setVersion('colaboradores')}>Colaboradores</button>
      </div>

      {secciones.map(s => (
        <section key={s.titulo} className="seccion-ayuda">
          <h3>{s.titulo}</h3>
          {s.cuando && <p className="muted" style={{ marginTop: -4 }}>{s.cuando}</p>}
          {s.cuerpo}
        </section>
      ))}
    </div>
  );
}
