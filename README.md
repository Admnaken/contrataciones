# NAKEN · Contrataciones

Aplicación web estática (HTML/CSS/JS puro, sin backend) para gestionar el circuito de contratación de servicios de mantenimiento en consorcios de la Ciudad Autónoma de Buenos Aires, siguiendo el protocolo de compliance de la Ley 941, la Disposición DGCADC 856/14 y la normativa laboral/tributaria conexa (ARCA, AGIP, ART, F.931, Ley 25.345, etc.).

## Qué gestiona

El protocolo se modela como un **expediente de contratación** que recorre cinco fases obligatorias, más dos vistos buenos:

1. **Solicitud de presupuesto** — genera el email formal con los 8 requisitos exigidos por la Disp. 856/14 y permite cargar los presupuestos recibidos con un checklist de cumplimiento por cada uno.
2. **Validación fiscal y técnica** — checklist de estado de CUIT en ARCA, Base APOC, padrón AGIP y matrícula AGC/SART.
3. **Instrumentación jurídica** — decide entre presupuesto aprobado o contrato de locación, con checklist de cláusulas mínimas y generador de contrato imprimible.
4. **Compliance laboral y previsional** — checklist diferenciado según el prestador sea monotributista independiente o empresa con personal, para neutralizar el riesgo de responsabilidad solidaria (Art. 30 LCT).
5. **Comprobantes, retenciones y pago** — validación de CAE, cálculo de retenciones SUSS/AGIP, control de medio de pago bancarizado y cálculo del monto neto a transferir.

**Visto Bueno para contratar**: solo se habilita cuando las Fases 1 a 4 están completas.
**Visto Bueno para liberar el pago**: solo se habilita cuando hay Visto Bueno de contratación y la Fase 5 está completa.

El panel general muestra alertas automáticas: ofertas próximas a vencer (15 días hábiles), expedientes esperando visto bueno, y riesgo de Art. 30 LCT por documentación laboral incompleta.

## Cómo usarla

Es un sitio 100% estático: no requiere servidor, base de datos ni build. Los datos se guardan en el `localStorage` del navegador (por eso conviene usar siempre el mismo navegador/dispositivo, o exportar/respaldar si se necesita usar desde otro lugar).

### Ejecutar en local

Abrir `index.html` con cualquier servidor estático simple, por ejemplo:

```bash
python3 -m http.server 8080
```

y entrar a `http://localhost:8080`. (Abrir el archivo directamente con `file://` también funciona, salvo la carga de PDFs adjuntos en algunos navegadores.)

### Publicar en GitHub Pages con dominio propio

La app queda pensada para publicarse en **`contrataciones.administracionnaken.com.ar`** (mismo patrón que `balancecero.administracionnaken.com.ar`). Ya incluye el archivo `CNAME` con ese subdominio, así que solo falta:

1. Subir esta carpeta a un repositorio de GitHub (puede ser privado).
2. En **Settings → Pages**, elegir la rama (`main`) y la carpeta raíz (`/`). GitHub detecta el archivo `CNAME` del repo y completa solo el campo "Custom domain"; si no lo completa automáticamente, escribir ahí `contrataciones.administracionnaken.com.ar` y guardar.
3. En el proveedor de DNS del dominio `administracionnaken.com.ar` (Cloudflare, según lo usado para Balance Cero), crear un registro:
   - **Tipo:** CNAME
   - **Nombre/host:** `contrataciones`
   - **Destino:** `<usuario-de-github>.github.io`
   - **Proxy de Cloudflare:** puede dejarse activado (naranja) una vez que el certificado TLS de GitHub Pages esté emitido; si al principio da error de certificado, desactivarlo (DNS only, nube gris) hasta que GitHub Pages confirme el dominio y después volver a activarlo.
4. Volver a **Settings → Pages** y tildar **"Enforce HTTPS"** una vez que el dominio figure como verificado (puede tardar unos minutos a horas en propagar).
5. Si en algún momento se quiere cambiar el subdominio, hay que editar el archivo `CNAME` en el repo (no solo la configuración de GitHub) para que coincidan.

### Clave de acceso

La pantalla de ingreso es un **filtro, no una protección real** (si el repositorio es público, el código es visible para cualquiera). Sirve para que nadie que entre al link vea los datos sin clave.

- Clave por defecto: `Contratar#NK26`
- Para cambiarla: abrir la consola del navegador (F12) en la pantalla de acceso y ejecutar:
  ```js
  await hashClave("MiNuevaClave")
  ```
  Copiar el resultado y reemplazar el valor de `AUTH_HASH_DEFAULT` en `js/auth-gate.js`.
- Si se necesita protección real (que ni siquiera se pueda ver el código sin autenticarse), la mejora recomendada es poner **Cloudflare Access** delante del sitio, igual que se evaluó para Balance Cero.

## Respaldo en Google Sheets (y cruce con la app principal de gestión)

Esta app no tiene backend propio (todo vive en `localStorage`), así que el respaldo no pasa por
ningún servidor de NAKEN: es la cuenta de Google del propio administrador autorizando, desde el
navegador, escribir en sus propias planillas de Google Sheets — mismo enfoque de OAuth2 client-side
que ya usa Balance Cero para su backup en Drive (Google Identity Services), pero acá con permiso
para Sheets en vez de Drive.

**Qué hace**: cada vez que se aprueba un Visto Bueno (de Contratación o de Pago) de un expediente
cuyo consorcio tiene un "ID de planilla" cargado, se agrega una fila con los datos de ese evento en
una hoja **"Contrataciones_Historial"** dentro de esa MISMA planilla de Google Sheets (la de
expensas de ese consorcio en la app principal, no una planilla aparte). Si falla por lo que sea (sin
internet, sin autorizar, el consorcio no tiene planilla vinculada) el expediente igual queda
guardado en `localStorage` como siempre — nunca bloquea ni condiciona el uso normal de la app.

**Por qué en la misma planilla de expensas**: para que la app principal de gestión (NAKEN
Consorcios) pueda leer ese historial con el mismo mecanismo que ya usa para leer otras hojas de esa
planilla (Mantenimiento, Seguros, etc.), sin agregar un tercer ID que vincular en ningún lado.

### Puesta en marcha (una sola vez)

1. En [Google Cloud Console](https://console.cloud.google.com/), crear (o reutilizar) un proyecto y
   habilitar la **Google Sheets API** (menú "APIs y servicios" → "Biblioteca").
2. En "APIs y servicios" → "Pantalla de consentimiento OAuth", configurarla en modo **Externo** (o
   Interno si la cuenta es Google Workspace) con el propio email como usuario de prueba — no hace
   falta publicarla para uso personal.
3. En "APIs y servicios" → "Credenciales" → "Crear credenciales" → **ID de cliente de OAuth** → tipo
   **Aplicación web**. En "Orígenes de JavaScript autorizados" agregar:
   - `https://contrataciones.administracionnaken.com.ar`
   - `http://localhost:8080` (o el puerto que se use para probar en local)
4. Copiar el Client ID generado (termina en `.apps.googleusercontent.com`) y pegarlo en
   `js/sheets-sync.js`, en `SHEETS_SYNC_CONFIG.clientId`.
5. En **Consorcios**, para cada consorcio que tenga planilla en la app principal, pegar el mismo ID
   de esa planilla en el campo nuevo "ID de la planilla de Google Sheets de este consorcio".
6. La primera vez que se apruebe un Visto Bueno con un consorcio vinculado, el navegador va a pedir
   autorización de Google (popup) — se acepta una sola vez, el token se renueva solo mientras dure
   la sesión del navegador.

**Nota sobre HTTPS**: igual que el login (`js/auth-gate.js`, ver más abajo), esta función de Google
solo trabaja en un "contexto seguro" (HTTPS o `localhost`) — en HTTP plano simplemente no hace nada
(ni tira error), así que en el dominio propio hay que esperar a que el certificado de GitHub Pages
esté activo para que el respaldo funcione (ver más arriba).

## Estructura de archivos

```
index.html          → shell de la app + pantalla de acceso
css/styles.css       → estilos (paleta navy/dorado de Administración NAKEN)
js/data.js            → modelo de datos y checklists legales (editable si cambia la normativa)
js/templates.js       → generadores de email, contrato y resumen de expediente
js/sheets-sync.js     → respaldo de los vistos buenos en Google Sheets (ver sección de arriba)
js/app.js             → lógica de la app, router y render de cada panel
js/auth-gate.js       → pantalla de acceso con clave
assets/logo.png       → logo de Administración NAKEN
```

## Mantenimiento de datos normativos

Algunos valores conviene revisarlos periódicamente porque la normativa o los importes de referencia cambian:

- `FERIADOS_AR_2026` en `js/data.js` — actualizar cada año.
- `TOPES_SUSS_2026` en `js/data.js` — mínimo no imponible orientativo del régimen SUSS (RG 1784/1785); el monto real se debe confirmar en cada caso, la app no lo aplica automáticamente, solo lo deja como referencia.
- Alícuota de retención AGIP — se carga manualmente por expediente porque varía según el padrón mensual vigente.

## Alcance y límites (a tener en cuenta)

- No reemplaza el asesoramiento de un contador o abogado: automatiza el *checklist* y la generación de documentos modelo, pero la validación real ante ARCA/AGIP/AGC se sigue haciendo en los sitios oficiales.
- No genera la carta documento de intimación ni representa a la administración ante un conflicto — eso, como en el resto del proyecto, queda para un profesional según el caso concreto.
- No tiene integración EN VIVO con "Mis Expensas" ni con el backend de la app principal de NAKEN
  Consorcios (son apps separadas a propósito, ver `claude/puente-contrataciones-retenciones.md` del
  otro proyecto). Sí existe, desde esta versión, un puente de UN SOLO SENTIDO: al aprobar un Visto
  Bueno, esta app respalda los datos del evento en la misma planilla de Google Sheets del consorcio
  (ver "Respaldo en Google Sheets" más arriba), para que la app principal pueda leerlos. Esta app
  nunca lee ni escribe nada de la app principal (Gastos_Mensual, retenciones, etc.).

## Próximas mejoras posibles

- Adjuntar el presupuesto en PDF directamente al Acta/Resumen imprimible.
- Cloudflare Access delante del sitio para autenticación real.
- Integrar el resumen final como un ítem más del checklist de "Cierre y Traspaso" o de la liquidación de expensas de la app principal.
- Hoy el "ID de planilla" de cada consorcio se carga a mano y por separado del que ya existe en la
  app principal (son registros de consorcios independientes) — si en algún momento las dos apps
  comparten un mismo directorio de consorcios, se podría autocompletar.
