/* ==========================================================================
   NAKEN · Contrataciones — sheets-sync.js
   Respaldo (y puente de datos) hacia Google Sheets: cada vez que se aprueba
   un Visto Bueno (de Contratación o de Pago), esta app -- que no tiene
   backend propio, solo localStorage -- escribe una fila con los datos del
   expediente en una hoja "Contrataciones_Historial" DENTRO de la misma
   planilla de Google Sheets del consorcio (la que usa la app principal de
   gestión, identificada por su Spreadsheet ID).

   Por qué ahí y no en una planilla aparte: la app principal ya abre esa
   planilla para todo lo demás (Gastos_Mensual, Mantenimiento_Historial,
   etc.), así que puede leer esta hoja nueva con el mismo mecanismo que ya
   usa para las demás -- sin agregar un tercer ID que vincular en ningún
   lado ni tocar el backend de la app principal para "recibir" nada.

   Cómo se autentica (sin backend propio): OAuth2 client-side con Google
   Identity Services (mismo enfoque que ya usa Balance Cero para su backup
   en Drive), pidiendo un access token de corta duración con el scope de
   Sheets. Nada de esto pasa por ningún servidor de NAKEN: es la cuenta de
   Google del propio administrador autorizando, desde el navegador, escribir
   en sus propias planillas.

   Es un RESPALDO, no la fuente de verdad: si falla (sin internet, token
   vencido, el usuario nunca autorizó, la planilla no tiene ese consorcio
   vinculado, etc.) el expediente igual queda guardado en localStorage como
   siempre -- nunca se debe interrumpir ni condicionar el flujo normal de
   la app por un error acá. Por eso todas las funciones públicas de este
   archivo devuelven una Promise que jamás rechaza hacia afuera: los errores
   se loguean en consola (y, si hay margen, se anotan en el historial local
   del expediente) pero nunca se propagan.
   ========================================================================== */

// ---------------------------------------------------------------------------
// Configuración -- COMPLETAR antes de usar (ver README.md, sección
// "Respaldo en Google Sheets" para los pasos exactos en Google Cloud Console).
// ---------------------------------------------------------------------------
const SHEETS_SYNC_CONFIG = {
  // OAuth 2.0 Client ID (tipo "Aplicación web") de un proyecto de Google
  // Cloud con la API de Google Sheets habilitada, con
  // "https://contrataciones.administracionnaken.com.ar" (y "http://localhost"
  // si se prueba en local) como Origen autorizado de JavaScript.
  clientId: '52664671179-d9f7lk5756sg2re9tdet6lm5bcqd7sdj.apps.googleusercontent.com',
  scope: 'https://www.googleapis.com/auth/spreadsheets',
  hojaHistorial: 'Contrataciones_Historial',
};

const ENCABEZADOS_HISTORIAL_CONTRATACIONES = [
  'Fecha del evento', 'N° de expediente', 'Evento', 'Aprobado por',
  'Proveedor', 'CUIT proveedor', 'Tipo de servicio', 'Área / instalación',
  'Tipo de mantenimiento', 'Descripción', 'Monto neto ($)', 'Monto IVA ($)',
  'Retención SUSS ($)', 'Retención AGIP/IIBB ($)', 'Medio de pago',
  'N° de factura', 'Observaciones', 'Link al expediente',
];

// ---------------------------------------------------------------------------
// Token de acceso (OAuth2 implícito vía Google Identity Services)
// ---------------------------------------------------------------------------
let _sheetsTokenClient = null;
let _sheetsTokenCache = null; // { accessToken, expiraEn (epoch ms) }

function _sheetsSyncDisponible() {
  // Mismo motivo que el fix de auth-gate.js: la API de Google (como
  // crypto.subtle) solo funciona en un "contexto seguro" (HTTPS o
  // localhost). En HTTP plano, ni siquiera intentamos -- fallar en
  // silencio acá es preferible a repetir el bug del login.
  if (!window.isSecureContext) return false;
  if (!SHEETS_SYNC_CONFIG.clientId) return false;
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) return false;
  return true;
}

function _obtenerTokenSheets() {
  if (!_sheetsSyncDisponible()) return Promise.resolve(null);

  const ahora = Date.now();
  if (_sheetsTokenCache && _sheetsTokenCache.expiraEn > ahora + 30000) {
    return Promise.resolve(_sheetsTokenCache.accessToken);
  }

  return new Promise((resolve) => {
    try {
      if (!_sheetsTokenClient) {
        _sheetsTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: SHEETS_SYNC_CONFIG.clientId,
          scope: SHEETS_SYNC_CONFIG.scope,
          callback: () => {}, // se pisa en cada llamado, ver abajo
        });
      }
      _sheetsTokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          _sheetsTokenCache = {
            accessToken: resp.access_token,
            expiraEn: Date.now() + (Number(resp.expires_in || 3600) * 1000),
          };
          resolve(resp.access_token);
        } else {
          console.warn('[sheets-sync] No se obtuvo access token:', resp);
          resolve(null);
        }
      };
      _sheetsTokenClient.requestAccessToken({ prompt: '' });
    } catch (err) {
      console.warn('[sheets-sync] Error pidiendo token de Google:', err);
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers de formato -- mismos formatos que ya usa la app principal, para
// que la hoja se pueda leer directo desde ahí sin tener que reinterpretar
// nada (ver claude/puente-contrataciones-retenciones.md en el otro proyecto).
// ---------------------------------------------------------------------------
function _fechaDDMMAAAA(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function _linkExpediente(expId) {
  return `https://contrataciones.administracionnaken.com.ar/#/expediente/${expId}`;
}

// ---------------------------------------------------------------------------
// Llamadas REST a la API de Sheets (fetch directo, sin ninguna librería --
// misma filosofía "sin dependencias" que el resto de esta app).
// ---------------------------------------------------------------------------
async function _sheetsFetch(spreadsheetId, path, token, options) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${path}`;
  const res = await fetch(url, Object.assign({}, options, {
    headers: Object.assign({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, (options && options.headers) || {}),
  }));
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    throw new Error(`Sheets API ${res.status}: ${texto.slice(0, 300)}`);
  }
  return res.json();
}

async function _asegurarHojaHistorial(spreadsheetId, token) {
  const meta = await _sheetsFetch(spreadsheetId, '?fields=sheets.properties.title', token, { method: 'GET' });
  const yaExiste = (meta.sheets || []).some(s => s.properties && s.properties.title === SHEETS_SYNC_CONFIG.hojaHistorial);
  if (yaExiste) return;

  await _sheetsFetch(spreadsheetId, ':batchUpdate', token, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEETS_SYNC_CONFIG.hojaHistorial } } }] }),
  });
  const rango = `${SHEETS_SYNC_CONFIG.hojaHistorial}!A1:${String.fromCharCode(64 + ENCABEZADOS_HISTORIAL_CONTRATACIONES.length)}1`;
  await _sheetsFetch(spreadsheetId, `/values/${encodeURIComponent(rango)}?valueInputOption=RAW`, token, {
    method: 'PUT',
    body: JSON.stringify({ values: [ENCABEZADOS_HISTORIAL_CONTRATACIONES] }),
  });
}

async function _agregarFilaHistorial(spreadsheetId, token, fila) {
  const rango = `${SHEETS_SYNC_CONFIG.hojaHistorial}!A:A`;
  await _sheetsFetch(spreadsheetId, `/values/${encodeURIComponent(rango)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, token, {
    method: 'POST',
    body: JSON.stringify({ values: [fila] }),
  });
}

// ---------------------------------------------------------------------------
// Función pública: registra UN evento (Visto Bueno de Contratación o de
// Pago) del expediente como una fila nueva en Contrataciones_Historial de
// la planilla del consorcio. "evento" es 'contratacion' o 'pago'.
// ---------------------------------------------------------------------------
async function sincronizarExpedienteEnPlanilla(exp, consorcio, evento) {
  try {
    if (!consorcio || !consorcio.spreadsheetId) {
      console.info('[sheets-sync] Este consorcio no tiene vinculado un Spreadsheet ID -- no se respalda en Sheets (el expediente igual quedó guardado localmente).');
      return;
    }
    const token = await _obtenerTokenSheets();
    if (!token) {
      console.info('[sheets-sync] No se pudo obtener autorización de Google -- no se respalda en Sheets esta vez (el expediente igual quedó guardado localmente).');
      return;
    }

    const p = exp.pago || {};
    const proveedor = presupuestoSeleccionado(exp) || {};
    const esContratacion = evento === 'contratacion';
    const vb = esContratacion ? exp.vistoBuenoContratacion : exp.vistoBuenoPago;

    const fila = [
      _fechaDDMMAAAA(vb.fecha),
      exp.id,
      esContratacion ? 'Visto Bueno de Contratación' : 'Visto Bueno de Pago',
      vb.por || '',
      proveedor.proveedorNombre || '',
      proveedor.proveedorCuit || '',
      exp.tipoServicio || '',
      exp.areaInstalacion || '',
      exp.tipoMantenimiento || '',
      exp.descripcion || '',
      esContratacion ? '' : (Number(p.montoNeto) || 0),
      esContratacion ? '' : (Number(p.montoIva) || 0),
      esContratacion ? '' : (p.aplicaSUSS ? (Number(p.montoRetSUSS) || 0) : 0),
      esContratacion ? '' : (p.aplicaAGIP ? (Number(p.montoRetAGIP) || 0) : 0),
      esContratacion ? '' : (p.medioPago || ''),
      esContratacion ? '' : (p.numeroFactura || ''),
      vb.observaciones || '',
      _linkExpediente(exp.id),
    ];

    await _asegurarHojaHistorial(consorcio.spreadsheetId, token);
    await _agregarFilaHistorial(consorcio.spreadsheetId, token, fila);
    console.info('[sheets-sync] Evento respaldado en la planilla del consorcio.');
  } catch (err) {
    // Nunca debe romper el flujo de aprobación -- ver nota al principio del archivo.
    console.warn('[sheets-sync] No se pudo respaldar el evento en Sheets (el expediente igual quedó guardado localmente):', err);
  }
}
