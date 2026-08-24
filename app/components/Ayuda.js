'use client';

import { useState } from 'react';

const SECCIONES_ADMIN = [
  {
    titulo: 'Entrar',
    cuerpo: (
      <p>
        <strong>Deja el campo de usuario en blanco</strong> y escribe solo la contraseña de administración.
        Ese campo (&quot;Username (collaborators only)&quot;) es únicamente para colaboradores: si escribes algo ahí,
        la app intenta entrar como colaborador y no te deja pasar.
      </p>
    ),
  },

  {
    titulo: 'Inicio',
    cuando: 'Acabas de pagar algo y tienes el ticket delante.',
    cuerpo: (
      <>
        <p>
          Es la pantalla de un solo trabajo: <strong>Subir factura suelta</strong>. El botón <strong>Subir ahora</strong> abre
          la cámara en el móvil o el explorador de archivos en el ordenador.
        </p>
        <p>
          Al elegir el archivo aparecen tres campos, los tres opcionales: <strong>Concepto</strong> (&quot;gasolina, cinta
          americana...&quot;), <strong>Importe</strong> (&quot;si lo sabes&quot;) y la <strong>fecha</strong>. Rellenarlos ayuda
          pero no hace falta: la app intenta leer el importe y la fecha del propio archivo. Lo que no consiga leer se
          arregla después desde Facturas, donde esos mismos campos se pueden escribir a mano.
        </p>
        <p>
          No hay que decir a qué movimiento pertenece. La factura se guarda y se empareja sola cuando aparezca su
          línea — puede ser hoy o puede ser cuando subas el excel del banco dentro de dos meses.
        </p>
      </>
    ),
  },

  {
    titulo: 'Movimientos',
    cuando: 'El trabajo de verdad: dejar cada movimiento explicado, para poder mandarlo a la gestoría.',
    cuerpo: (
      <>
        <p>
          Una fila por cada movimiento del banco. El objetivo es que ninguno quede sin explicar — o tiene su factura, o dice
          por qué no la lleva.
        </p>

        <h4>La barra de arriba</h4>
        <p>Son tres grupos separados por una raya vertical, y cada uno es un momento distinto:</p>
        <ul>
          <li>
            <strong>Excel del banco</strong> — el extracto. Si subes el combinado con las tres pestañas (bbva, openbank,
            paypal), déjalo en &quot;Detectar automáticamente&quot;; si es el export suelto de un banco, dilo en el desplegable.
            Volver a subir el mismo excel no borra nada de lo que ya hayas resuelto: fusiona.
          </li>
          <li>
            <strong>Devoluciones</strong> — las que todavía no se han mandado. Van como pestaña propia en el excel del
            próximo envío.
          </li>
          <li>
            <strong>Archivos subidos</strong> — todo lo que has subido, excels del banco y CSV de LarpManager, con su fecha
            y cuánto trajo cada uno. Desde aquí se borra una subida entera si te equivocaste de archivo. Borrar un excel
            del banco se lleva sus movimientos y lo que hubieras resuelto en ellos; borrar un CSV de LarpManager
            <strong> no toca los movimientos</strong>, solo se lleva sus pagos, y se recupera volviendo a subirlo.
            El aviso antes de borrar te dice exactamente cuánto se pierde.
          </li>
          <li>
            <strong>Enviar a gestoría</strong> — el paquete final. Ver más abajo.
          </li>
        </ul>
        <p>
          A la derecha del todo, <strong>X de Y resueltos</strong> con su barra. No cuenta las líneas ignoradas ni las de
          factura futura, porque ahora mismo no dependen de nadie: mide lo que de verdad queda por hacer.
        </p>

        <h4>La barra de la tabla</h4>
        <ul>
          <li><strong>Buscar en cualquier columna</strong> — texto libre, incluidas las columnas extra que tengas activadas.</li>
          <li><strong>Fechas</strong> — desde/hasta, y &quot;Ver todo&quot; para quitarlo.</li>
          <li><strong>Solo pendientes</strong> — viene marcado. Oculta lo resuelto, lo ignorado y las facturas futuras.</li>
          <li>
            <strong>Agrupar proveedores</strong> — vuelve al agrupado normal después de haber ordenado por una columna.
            <strong> Reagrupar proveedores</strong> es otra cosa: recalcula los grupos desde cero, para después de haber
            cambiado proveedores a mano.
          </li>
          <li><strong>Columnas</strong> — enseña columnas extra que venían en el excel original y no se ven por defecto (Saldo, por ejemplo). La de LarpManager viene activada.</li>
          <li>A la derecha, <strong>N pendientes</strong> — al pulsarlo vuelve a marcar &quot;Solo pendientes&quot;.</li>
        </ul>
        <p className="muted">
          Pulsar el nombre de una columna ordena por ella (una vez ascendente, otra descendente, otra vuelve al
          agrupado). Al ordenar se pierde el agrupado por proveedor. Los bordes de las cabeceras se arrastran para
          cambiar el ancho, y los anchos se recuerdan.
        </p>

        <h4>Las nueve columnas</h4>
        <ul>
          <li><strong>Fecha</strong> y <strong>Concepto</strong> — lo que escribe el banco, tal cual. Se quedan fijas al desplazarse a lo ancho.</li>
          <li><strong>Banco</strong> — de qué extracto viene la línea.</li>
          <li><strong>Proveedor</strong> — quién cobró. <em>Es el campo que agrupa</em>: dos líneas con el mismo proveedor se juntan aunque el banco las escriba distinto y aunque sean de bancos distintos. Borrarlo desagrupa la línea y además hace que la app olvide lo que había aprendido de ahí.</li>
          <li><strong>Importe</strong> — el del movimiento.</li>
          <li><strong>Estado</strong> — ver la tabla de abajo.</li>
          <li><strong>Factura</strong> — el número de cada factura vinculada, no la palabra &quot;ver&quot;. Es el mismo nombre que lleva el archivo dentro del zip de la gestoría, y cada número abre el suyo. Si no hay ninguna y la línea sigue esperando factura, aquí sale el botón <strong>Subir</strong>.</li>
          <li><strong>Nota</strong> — ver más abajo, tiene su propio apartado.</li>
          <li><strong>Proyecto</strong> — a qué proyecto se imputa.</li>
        </ul>

        <h4>Qué significa cada estado</h4>
        <TablaEstados filas={[
          ['pendiente', 'Todavía no se ha hecho nada con esta línea.'],
          ['pedida', 'Ya se ha reclamado la factura, esperando a que llegue.'],
          ['factura futura', 'El proveedor no emite factura hasta que el servicio ha pasado (vuelos, coches de alquiler). No es trabajo de ahora: queda aparcada hasta que se cierre el proyecto, y aparece en su ficha.'],
          ['ignorar', 'No necesita nada. Ni factura, ni nota, ni seguimiento.'],
          ['devolución', 'Es dinero devuelto a un jugador, no un gasto con factura. Al elegirlo se abre el campo del jugador.'],
          ['resuelta', 'Terminada. Se puede volver a cambiar cuando quieras: el desplegable nunca se bloquea.'],
        ]} />
        <p className="muted">
          Ni <strong>ignorar</strong> ni <strong>factura futura</strong> cuentan como pendientes: desaparecen de &quot;Solo
          pendientes&quot; y no restan en el contador de arriba.
        </p>

        <h4>Qué es la Nota (y qué no)</h4>
        <p>
          La Nota es <strong>el texto que se escribe en el excel que se manda a la gestoría</strong>, en la fila de esa
          línea. Nada más.
        </p>
        <p>
          No es el sitio del proveedor, que tiene su columna, ni el de la factura, que tiene la suya. Durante mucho
          tiempo lo fue —cuando se hizo la Nota no existían las otras dos columnas— y por eso hay notas antiguas que son
          un nombre de proveedor o un número de factura. <strong>La app ya no escribe ahí el número de factura</strong>:
          al emparejar, la nota es el concepto que se escribió al subirla, y si no había, se queda vacía.
        </p>
        <p>
          El campo enseña siempre <em>la nota que ya está guardada</em>, para poder corregirla o borrarla, y funciona
          aunque la línea esté resuelta. Guarda con Enter y también al salir del campo. Dejarla vacía a propósito
          también se aprende: si dices que ahí no va nota, deja de proponerte una.
        </p>

        <h4>Las sugerencias</h4>
        <p>
          Todo lo que propone la app tiene la misma forma, sea del tipo que sea: una <strong>píldora de color</strong> con
          una ✕ dentro. Pulsar el texto la acepta; pulsar la ✕ la rechaza.
        </p>
        <p>
          O está la píldora o está el campo, nunca las dos cosas: mientras hay sugerencia se ve solo ella, y al
          rechazarla aparece el campo vacío como si nunca hubiera habido ninguna. A una línea ya resuelta no se le
          propone nada.
        </p>
        <div className="resumen-mini" style={{ display: 'block' }}>
          <strong>Rechazar es para siempre, y no se puede deshacer desde la app.</strong> La ✕ no vale solo para esa
          línea: vale para ese tipo de movimiento entero, y sigue valiendo después de recargar. En nota y proveedor,
          rechazar es además <em>olvidar lo aprendido</em>. La ✕ del proveedor calla todas sus fuentes de golpe, porque
          ahí significa &quot;esta línea no tiene proveedor&quot;.
        </div>
        <p className="muted">
          Las de LarpManager son la excepción: son candidatos de un pago concreto, no una regla, así que su ✕ solo dura
          hasta que recargues.
        </p>
        <h4>Combinaciones de facturas</h4>
        <p>
          En la columna <strong>Factura</strong> de una línea pendiente puede salir una sugerencia tipo
          <strong> facturas 17 + 16</strong>: son dos facturas ya subidas cuyos importes suman el de esa línea, el caso
          típico de un pago que trae dos tickets. Aceptarla adjunta las dos y deja la línea resuelta — exactamente lo
          mismo que aceptarla desde la pestaña Facturas, donde sale la explicación con los importes de cada una. Su ✕
          también es para siempre, y va por esas facturas concretas: rechazar &quot;17 + 16&quot; no rechaza otras
          combinaciones futuras.
        </p>

        <h4>Los grupos</h4>
        <p>
          Las líneas del mismo proveedor se juntan bajo una fila gris, para poder resolver varias de una vez. Un grupo
          de una sola línea no lleva cabecera: es una fila normal.
        </p>
        <p>En la fila del grupo, cada campo actúa sobre todas sus líneas a la vez:</p>
        <ul>
          <li><strong>Proveedor</strong> — el nombre del grupo. Cambiarlo lo renombra entero; vaciarlo lo deshace y olvida lo aprendido.</li>
          <li><strong>Estado</strong> — solo pedida o resuelta, y solo si al grupo le queda algo pendiente.</li>
          <li><strong>Nota</strong> — siempre disponible, incluso con el grupo entero resuelto, que es cuando hace falta para corregir. Enseña la nota que comparten todas sus líneas, o vacío si cada una tiene la suya.</li>
          <li><strong>Proyecto</strong> — con la opción <strong>— (quitar)</strong> para dejarlas sin proyecto.</li>
        </ul>
        <p>
          Si hay una nota aprendida para el grupo, la píldora dice cuántas líneas cerraría de golpe
          (<em>ticket · 5 líneas</em>).
        </p>

        <h4>La columna de LarpManager</h4>
        <p>
          Sale de cruzar el CSV contra las líneas de ingreso. Puede decirte cuatro cosas: el nombre y el evento de quien
          pagó, <em>&quot;N coincidencias posibles&quot;</em> cuando hay varias personas que encajan,
          <em> &quot;el importe no cuadra&quot;</em>, o <em>&quot;no encontrada&quot;</em>.
        </p>
        <div className="resumen-mini" style={{ display: 'block' }}>
          <strong>&quot;El importe no cuadra&quot; no se resuelve desde aquí.</strong> Significa que el nombre sí aparece
          en el banco pero por otra cantidad — normalmente porque el dato de LarpManager está mal. La app no te lo
          propone a propósito: taparlo aquí dejaría la línea cerrada con el pago equivocado. Se arregla en LarpManager
          y se vuelve a subir el CSV.
        </div>
        <p>
          Cuando una línea ya tiene su pago, aparece un <strong>✎</strong> al lado para <strong>quitar el vínculo</strong>
          si te has equivocado. El pago vuelve a la pestaña LarpManager y la línea deja de decir de quién es — pero
          <em> no cambia de estado</em>: si estaba resuelta sigue resuelta, y eso se cambia a mano en Estado.
        </p>
        <p>
          Y si no tiene pago, hay un <strong>Vincular</strong> para ponérselo desde aquí, sin ir a la otra pestaña. Abre
          debajo de la fila la lista de pagos que todavía no tienen movimiento —nombre, evento, importe y fecha—, con los
          que llevan su nombre en el concepto o cuadran de importe arriba del todo, y un buscador porque el banco muchas
          veces no escribe el apellido (&quot;Registration fee 2 of Calum&quot;). Los pagos que ya pusiste en
          <em> ignorar</em> salen también, para que los veas, pero sin botón: primero hay que devolverlos a pendiente.
        </p>

        <h4>Devoluciones</h4>
        <p>
          Se marca eligiendo <strong>devolución</strong> en el Estado — está disponible en cualquier línea, no hace falta
          que el banco use esa palabra. Al elegirlo se abre en la columna Nota el campo
          <strong> Jugador en LarpManager</strong>, que se propone solo si el concepto lo deja ver, y dos botones:
          <strong> Confirmar devolución</strong> y <strong>Cancelar</strong>. Hasta que confirmes no se guarda nada.
        </p>
        <p>
          Una devolución ya marcada se lee como <em>Devolución — nombre del jugador</em>, con un <strong>✎</strong> al lado
          para corregir el nombre. Una devolución no tiene proveedor ni factura: en esa columna verás un guion.
        </p>

        <h4>Enviar a gestoría</h4>
        <p>
          Se elige una fecha <strong>Hasta</strong> y una <strong>Etiqueta</strong> (&quot;Enero-Marzo 2026&quot;), y antes de
          generar nada te dice qué va a entrar: cuántos movimientos, cuántas facturas, cuántas devoluciones y el total.
        </p>
        <p>
          Entra todo lo resuelto y todavía sin enviar hasta esa fecha, <strong>incluido lo recuperado tarde</strong> — una
          factura futura que llega dos meses después entra en el envío siguiente aunque su fecha sea anterior. Lo que ya
          se envió una vez no vuelve a salir.
        </p>
        <p>
          Se descarga un <strong>.zip</strong> con las facturas numeradas y el excel original con las notas escritas
          encima, más las columnas que sabe la app: Nota gestoría, Proveedor, Proyecto, Facturas, Jugador y LarpManager.
          Las facturas de colaboradores que se pagaron entran en el mismo paquete y con la misma numeración. Solo cuando
          el zip se ha generado bien se marca todo como enviado.
        </p>
      </>
    ),
  },

  {
    titulo: 'Facturas',
    cuando: 'Para subir varias de golpe, y para arreglar las que no encontraron su línea.',
    cuerpo: (
      <>
        <p>
          Una fila por factura, venga de donde venga: de Inicio, de una línea de Movimientos o de un colaborador. El
          botón <strong>📎 Subir facturas</strong> admite varios archivos a la vez — es el único sitio donde se sube en
          lote.
        </p>

        <h4>Las columnas</h4>
        <ul>
          <li><strong>Fecha</strong>, <strong>Concepto</strong> e <strong>Importe</strong> — lo que la app leyó del archivo, y se pueden corregir a mano mientras la factura no esté emparejada. El importe se escribe como se escribe aquí: 2.183,18 se entiende bien.</li>
          <li><strong>Nombre</strong> — el archivo; el enlace lo abre. Un ⚠ al lado significa que hay otro archivo subido con ese mismo nombre.</li>
          <li><strong>Subida</strong> y <strong>Subido por</strong> — cuándo y quién.</li>
          <li><strong>Vincular</strong> — el botón <strong>Buscar</strong> vuelve a intentar el cruce solo de esa factura. Si no hay manera, se elige a mano en <strong>Elige movimiento...</strong> y se pulsa <strong>Vincular</strong>.</li>
          <li><strong>Motivo</strong> — por qué no está emparejada. Es la columna que dice qué hacer.</li>
          <li><strong>Movimiento</strong> — el movimiento con el que quedó emparejada.</li>
        </ul>

        <h4>Qué te puede decir el Motivo</h4>
        <TablaEstados filas={[
          ['Emparejada', 'Tiene su movimiento. No hay nada que hacer.'],
          ['Varias líneas con el mismo importe', 'Hay más de una candidata y la app no elige por ti: salen los botones con fecha, importe y concepto de cada una para que elijas.'],
          ['Combinación de facturas sugerida', 'Varias facturas suman el importe de una línea (típico de un PDF con dos facturas dentro). Se propone, nunca se aplica sola.'],
          ['Ya cubierta por otra factura', 'Ese gasto ya tiene su justificante. No falta nada.'],
          ['Importe no coincide con ninguna línea', 'El importe está leído pero no cuadra con nada pendiente. Puede que falte subir el excel de esas fechas.'],
          ['No se reconoció ningún importe', 'No se pudo leer la cifra. Escríbela a mano en la columna Importe.'],
          ['Es una imagen, no se puede leer', 'Una foto sin texto dentro. O escribes el importe a mano, o usas "Leer con IA".'],
          ['Aún no hay movimientos con los que comparar', 'Todavía no se ha subido ningún excel del banco.'],
          ['Error al procesar el archivo', 'El archivo no se pudo abrir.'],
        ]} />

        <h4>Los botones de arriba</h4>
        <ul>
          <li><strong>Solo pendientes</strong> — oculta las ya emparejadas.</li>
          <li><strong>Columnas</strong> — para ocultar las que no te interesen.</li>
          <li><strong>Descargar CSV</strong> — la lista de lo que queda sin resolver, para trabajarla fuera.</li>
          <li><strong>Recalcular facturas sin resolver</strong> — vuelve a intentar el cruce de todas de golpe. Es lo que hay que pulsar después de subir un excel del banco nuevo.</li>
          <li>
            <strong>Leer con IA (N)</strong> — para las que no tienen importe porque son fotos o PDFs ilegibles. El número
            dice cuántas hay en ese caso.
            <br />
            <span className="muted">Ojo: esto no es gratis. Tiene un coste pequeño por cada factura que lee, así que no
            conviene pulsarlo por costumbre — solo cuando de verdad no se pueda leer a mano.</span>
          </li>
        </ul>
        <p>
          Abajo del todo se pueden marcar varias con la casilla y usar <strong>Borrar seleccionadas</strong>. Si alguna
          estaba emparejada, el aviso te dice cuántas y que su movimiento volverá a quedar pendiente.
        </p>
      </>
    ),
  },

  {
    titulo: 'LarpManager',
    cuando: 'Para comprobar que el dinero que LarpManager da por cobrado ha llegado de verdad al banco.',
    cuerpo: (
      <>
        <p>
          Una fila por cada pago que LarpManager da por hecho, y si su ingreso está o no en el banco. Al entrar se
          cruza otra vez, así que lo que ves es de ahora mismo.
        </p>
        <div className="resumen-mini" style={{ display: 'block' }}>
          <strong>La app propone, tú validas. Nunca enlaza sola.</strong> Cada pago sin movimiento enseña su propuesta
          como una píldora en la columna <strong>Movimiento</strong>: pulsas el texto y queda enlazado, pulsas la ✕ y
          se descarta. Lo hace así porque un acierto falso, cerrado en silencio, deja un ingreso dado por cobrado sin
          haberlo cobrado.
        </div>

        <h4>Los dos botones</h4>
        <ul>
          <li>
            <strong>Subir pagos de LarpManager</strong> — el export de pagos, en `.csv` o en `.xlsx`. Se guarda entero,
            pero contra el banco solo se cruzan las transferencias y las filas sin método de pago, que son las que
            acaban llegando a la cuenta. Las de pasarela (Stripe, Redsys) y los apuntes internos (larpmoney,
            larpmanager) se guardan pero no se cruzan: ese dinero no aparece en el banco línea a línea. Subir el mismo
            archivo dos veces no duplica nada.
          </li>
          <li>
            <strong>Recalcular</strong> — vuelve a cruzar sin salir y volver a entrar. Sirve sobre todo justo después
            de subir un excel del banco con líneas nuevas.
          </li>
        </ul>

        <h4>Las dos clases de propuesta</h4>
        <p>
          <strong>Firme</strong>, en índigo: mismo apellido y mismo importe. <strong>Con dudas</strong>, en ámbar: la
          app ha encontrado algo que podría ser, pero no lo tiene claro — o el banco escribe solo parte del nombre, o
          el importe no cuadra. Las dos se aceptan con el mismo clic, y por eso se distinguen a simple vista: el ámbar
          quiere decir <em>míralo antes de darle</em>. Es el único sitio de la aplicación donde hay un color que no
          sea el de acento.
        </p>
        <p>
          La <strong>✕ es para siempre</strong>: queda guardado que ese movimiento no es de esa persona y no se vuelve
          a proponer. Y como el reparto sigue buscando, al rechazar una sale la siguiente — o ese movimiento pasa a
          proponérsele a otro pago que lo estuviera esperando.
        </p>

        <h4>Qué te puede decir el &quot;Por qué&quot;</h4>
        <p className="muted">
          Es una etiqueta corta y nada más. Cuál es el movimiento y de quién es lo enseñan la columna
          <strong> Movimiento</strong> y el panel de Vincular; esta columna solo dice en qué situación está el pago.
        </p>
        <TablaEstados filas={[
          ['Ok', 'Encaja el apellido y el importe. Es la propuesta firme, la de color índigo.'],
          ['El importe no cuadra', 'El apellido sí aparece en el banco pero por otra cantidad. Normalmente el dato de LarpManager está mal: se arregla allí y se vuelve a subir. Aun así te propone el más cercano, en ámbar.'],
          ['Solo coincide parte del nombre', 'Coincide el nombre de pila pero no el apellido, porque el banco lo corta (Van den Esschert llega como "Van Den Ess"). Te propone el más cercano, en ámbar.'],
          ['No aparece en el banco', 'Ni rastro de ese nombre. O la transferencia no ha llegado, o falta subir el extracto de esas fechas. Aquí no hay nada que proponer.'],
          ['Sin movimiento libre', 'Hay movimientos por ese importe con su apellido, pero ya están dados. Tampoco hay propuesta: no queda ninguno libre.'],
          ['Emparejado', 'Ya tiene su movimiento. Estos solo salen al quitar "Solo pendientes".'],
          ['Ignorado a mano', 'Lo pusiste en "ignorar": no se espera ningún ingreso.'],
          ['Dado por bueno a mano', 'Lo pusiste en "resuelto" sin movimiento.'],
        ]} />

        <h4>El estado de cada pago</h4>
        <p>
          Igual que en Movimientos: <strong>pendiente</strong> (falta su ingreso), <strong>resuelto</strong> (lo pone
          la app al enlazarlo, y lo puedes poner tú cuando el pago es bueno pero no va a tener movimiento) e
          <strong> ignorar</strong> (de este no esperes nada: anulado, metido por error). La casilla
          <strong> Solo pendientes</strong> esconde los otros dos, y quitándola vuelven para poder deshacerlos.
        </p>
        <p className="muted">
          Poner un pago en <em>ignorar</em> es lo que antes obligaba a borrar el archivo entero y subir uno recortado.
          La fila se queda guardada, así que volver a subir el mismo export no la resucita.
        </p>

        <h4>Vincular a mano, y que aprenda</h4>
        <p>
          Cuando ninguna propuesta vale, <strong>Vincular</strong> abre un panel debajo de la fila, a todo el ancho.
          Trae dos cosas: <strong>todos los pagos de esa persona</strong> con el movimiento que le tocó a cada uno
          —incluidos los que nunca pasan por el banco, como larpmoney— y la lista de <strong>movimientos</strong> entre
          los que elegir, con el concepto entero. Primero los que llevan su nombre o su importe; detrás de
          &quot;Ver todas&quot;, el resto. No salen los marcados como Stripe, que son liquidaciones de la pasarela.
        </p>
        <p>
          El histórico está ahí porque es lo único que permite decidir: ver que tiene cuatro pagos, que tres cuadraron
          y que este falta, o que ese dinero entró por larpmoney y no va a estar nunca en el banco.
        </p>
        <div className="resumen-mini" style={{ display: 'block' }}>
          <strong>Se valida una vez y ya está.</strong> Al aceptar, la app aprende cómo llama el banco a esa persona y
          lo aplica al resto de sus pagos. El caso real: donde LarpManager pone <em>Matthias Greßer</em>, el banco
          escribe <em>Greer Matthias Rola</em> — se come la ß en vez de convertirla en ss. Aceptas uno y los demás
          encajan solos.
        </div>
        <p>
          Aprende <strong>solo las palabras pegadas a su nombre</strong> dentro del texto del movimiento, nunca el
          papeleo de alrededor. De <em>ANTON VIEJO ALONSO Registration fee 2 ticket 2027</em> se queda con
          <em> VIEJO</em>, no con <em>Registration</em> ni con <em>2027</em>. Y no aprende tratamientos (Miss, Mrs),
          ni el nombre de otro jugador, ni nombres de evento, ni referencias.
        </p>
        <p className="muted">
          Solo aprende cuando lo aceptas tú, nunca por su cuenta. Y lo aprendido no se puede ver ni borrar desde la
          aplicación: si aprende algo mal, se queda.
        </p>

        <h4>La regla que no se rompe</h4>
        <p>
          <strong>Un movimiento del banco justifica un solo pago, y un pago un solo movimiento.</strong> Cuando varios
          encajan, decide la <strong>fecha más cercana</strong> — da igual antes o después, porque el desfase entre que
          se registra el pago y el banco lo apunta va en las dos direcciones. Así dos cuotas de 150 € de la misma
          persona no se cierran las dos contra el mismo ingreso. Y tampoco se te propone nunca un movimiento que ya
          esté propuesto a otro pago.
        </p>
        <p className="muted">
          El apellido tiene que aparecer como <strong>palabra entera</strong>. Buscar trozos de texto cerraba el pago
          de <em>Alon</em> contra un ingreso de <em>Alonso</em>: el dinero de uno quedaba dado por cobrado con el
          ingreso del otro.
        </p>
      </>
    ),
  },

  {
    titulo: 'Proyectos',
    cuando: 'Al empezar un proyecto nuevo, y al ir a cerrarlo.',
    cuerpo: (
      <>
        <p>
          <strong>+ Añadir proyecto</strong> pide solo el nombre. La lista no está atada a ningún trimestre: el mismo
          proyecto se usa todo el tiempo que dure.
        </p>
        <p>Al entrar en uno se ven sus tres pendientes de cierre, cruzando todas las fechas:</p>
        <ul>
          <li><strong>Devoluciones</strong> — todo lo devuelto a jugadores de ese proyecto, con <strong>Descargar CSV</strong>.</li>
          <li><strong>Facturas futuras sin recuperar</strong> — los gastos cuya factura todavía no existe. Esta es la lista que dice si el proyecto se puede cerrar de verdad.</li>
          <li><strong>Facturas de colaboradores pendientes</strong> — las de cualquier lote del proyecto que siguen sin revisar o revisadas pero sin cerrar, con una columna <strong>Paga</strong> que distingue las que pagó NOL de las que puso el colaborador de su bolsillo.</li>
        </ul>
      </>
    ),
  },

  {
    titulo: 'Colaboradores',
    cuando: 'Alguien del equipo va a gastar dinero de un proyecto.',
    cuerpo: (
      <>
        <p>
          <strong>+ Añadir colaborador</strong> pide nombre y correo, nada más. <strong>No se le asigna proyecto</strong>:
          lo elige él mismo cada vez que sube una factura, y su lote se crea solo la primera vez.
        </p>
        <div className="resumen-mini" style={{ display: 'block' }}>
          Si ese correo ya existe, no se manda contraseña nueva — solo se le actualizan los permisos. La invitación por
          correo sale una única vez.
        </div>
        <p>La tabla tiene una fila por persona y proyecto, y desde ella se cambia todo en caliente:</p>
        <ul>
          <li><strong>Estado</strong> — activo o inactivo.</li>
          <li><strong>Puede invitar</strong> — deja que invite a otra persona a ese mismo proyecto.</li>
          <li><strong>Sube facturas NOL</strong> — le añade en su formulario la opción de decir que <em>paga NOL</em>, no él. Sin este permiso, todo lo que suba se entiende que lo pagó de su bolsillo y se le debe.</li>
        </ul>
        <p>
          Quien todavía no ha subido nada aparece igualmente, sin proyecto. Pulsando su nombre se entra a sus
          <strong> Cuentas</strong>: cada factura suya con su estado, los pagos que se le han hecho y lo que queda
          pendiente.
        </p>
        <p>El estado de cada factura suya lo pones tú, y ninguno se guarda sin más:</p>
        <TablaEstados filas={[
          ['revisar', 'Recién subida, sin comprobar.'],
          ['aceptada', 'Correcta. Cuenta como deuda con esa persona.'],
          ['rechazada', 'Te pide el motivo antes de guardar, y el motivo se le enseña a ella.'],
          ['cerrada', 'Te pide la fecha de cierre. Pagada y terminada.'],
          ['borrada', 'Pide confirmación aparte. Desaparece de sus cuentas.'],
        ]} />
        <p>
          Los pagos se registran uno a uno con su importe y una nota (&quot;anticipo&quot;, &quot;diferencia&quot;), porque un
          anticipo y su liquidación son dos movimientos distintos del banco. Cada pago se puede vincular a la línea del
          banco que le corresponde.
        </p>
        <div className="resumen-mini" style={{ display: 'block' }}>
          Las facturas de colaborador que se pagaron <strong>sí llegan a la gestoría</strong>, dentro del mismo zip y con
          la misma numeración que las demás. Basta con que su pago esté vinculado a una línea del envío.
        </div>
      </>
    ),
  },
];

const SECCIONES_COLABORADORES = [
  {
    titulo: 'Signing in',
    cuerpo: (
      <p>
        Use your email address and the password you chose when you accepted the invitation. If you have forgotten it,
        use <strong>Forgot your password?</strong> on the sign-in screen. The password field on its own is for the
        administrator — you need to fill in your email too.
      </p>
    ),
  },

  {
    titulo: 'Details for the invoice',
    cuando: 'Read this before you buy anything.',
    cuerpo: (
      <>
        <p>
          Whenever you ask a supplier for an invoice, it has to be made out to the association, never to you. Without
          that we cannot pay you back — it is a legal requirement, not a preference.
        </p>
        <div className="resumen-mini" style={{ display: 'block' }}>
          <strong>NotOnlyLarp</strong><br />
          G87705794<br />
          Josué Lillo 10, 1º B<br />
          28053 Madrid, Spain
        </div>
        <p className="muted">
          These details are also shown at the top of your screen, so you can read them out at the till.
        </p>
      </>
    ),
  },

  {
    titulo: 'Uploading an invoice',
    cuerpo: (
      <>
        <p>
          Use <strong>Upload invoice</strong>. On a phone this opens the camera, so you can photograph a receipt on the
          spot instead of keeping it in your pocket.
        </p>
        <p>Fill in:</p>
        <ul>
          <li><strong>Description</strong> — what it was for (&quot;petrol&quot;, &quot;gaffer tape&quot;).</li>
          <li><strong>Amount</strong> — what you paid.</li>
          <li><strong>Date</strong> — when you paid it.</li>
          <li><strong>Choose project...</strong> — which project it belongs to. This is how the money gets counted in the right place.</li>
        </ul>
        <p>
          You are not assigned to a project in advance: you pick one every time you upload. The first time you upload
          something for a project, it appears from then on under <strong>Your projects</strong>.
        </p>
        <p className="muted">
          If administration has given you the NOL permission, you will also see a choice between <strong>I pay</strong> and
          <strong> NOL pays</strong>. Leave it on &quot;I pay&quot; for anything you paid yourself — that is what tells the
          system you are owed the money. Only use &quot;NOL pays&quot; for something paid directly by the association.
        </p>
      </>
    ),
  },

  {
    titulo: 'Your projects',
    cuerpo: (
      <p>
        Each project you have uploaded to, with the total you have uploaded for it. Selecting one opens that project:
        the title changes to its name, and your invoices and payments for it appear below. <strong>Switch project</strong>
        in the top right takes you back out.
      </p>
    ),
  },

  {
    titulo: 'Accounts',
    cuando: 'Where you check what you are still owed.',
    cuerpo: (
      <>
        <p>Every invoice you have uploaded for that project, and where it has got to:</p>
        <TablaEstados filas={[
          ['Unreviewed', 'Uploaded, not checked by administration yet.'],
          ['Accepted', 'Checked and correct. The money is owed to you.'],
          ['Rejected', 'Something is wrong. The reason is shown next to the invoice.'],
          ['Closed', 'Paid and finished, with the date it was closed.'],
        ]} />
        <p>
          <strong>Payments</strong> shows what has already been paid to you, and <strong>Pending</strong> what is still
          outstanding. A single invoice can be paid in more than one go — an advance now and the rest later is normal,
          and both appear separately.
        </p>
        <p className="muted">
          A rejected invoice is usually a receipt rather than a proper invoice, or one made out to your name instead of
          the association&apos;s. Ask the supplier for a corrected one and upload it again.
        </p>
      </>
    ),
  },

  {
    titulo: 'Inviting someone else',
    cuando: 'Only if administration has given you permission for this project.',
    cuerpo: (
      <p>
        <strong>Invite</strong> with their name and email. They get an email to choose their own password, and they join
        the same project you are in.
      </p>
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

function Secciones({ secciones }) {
  return (
    <>
      {secciones.map(s => (
        <section key={s.titulo} className="seccion-ayuda">
          <h3>{s.titulo}</h3>
          {s.cuando && <p className="muted" style={{ marginTop: -4 }}>{s.cuando}</p>}
          {s.cuerpo}
        </section>
      ))}
    </>
  );
}

export default function Ayuda({ soloColaboradores = false }) {
  const [version, setVersion] = useState('admin');

  if (soloColaboradores) {
    return <Secciones secciones={SECCIONES_COLABORADORES} />;
  }

  return (
    <div>
      <div className="interruptor-ayuda">
        <button type="button" className={version === 'admin' ? 'activa' : ''} onClick={() => setVersion('admin')}>Administración</button>
        <button type="button" className={version === 'colaboradores' ? 'activa' : ''} onClick={() => setVersion('colaboradores')}>Colaboradores</button>
      </div>

      <Secciones secciones={version === 'admin' ? SECCIONES_ADMIN : SECCIONES_COLABORADORES} />
    </div>
  );
}
