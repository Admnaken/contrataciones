/* ==========================================================================
   NAKEN · Contrataciones — api.js
   Comunicación con el servidor de la app principal (Google Apps Script).
   Los expedientes ya no se guardan en el navegador: viven en el servidor,
   con el mismo usuario y clave de administrador de la app principal.
   ========================================================================== */

const API_URL = 'https://script.google.com/macros/s/AKfycbzhU8dbssSczc_UBYqb6l_-n5dHIqIOqsqL6vFXypnX_hlX9oj0SmJHGOKh46e0uVlkHA/exec';
// Mismo token público que usa la app principal para el login (no es un secreto: la
// seguridad real es el usuario y la clave, que se validan en el servidor).
const API_TOKEN_PUBLICO = '9OCpNdEBMfc4zl3BtLUOahQm0DNx4azDX1O9OS0D';
const SESION_KEY = 'naken_contrataciones_sesion';

const Api = {
  token() {
    try { return sessionStorage.getItem(SESION_KEY) || localStorage.getItem(SESION_KEY) || ''; } catch (e) { return ''; }
  },
  guardarToken(token, recordar) {
    try {
      sessionStorage.setItem(SESION_KEY, token);
      if (recordar) localStorage.setItem(SESION_KEY, token); else localStorage.removeItem(SESION_KEY);
    } catch (e) { /* sin almacenamiento: dura mientras la pestaña esté abierta */ }
  },
  borrarToken() {
    try { sessionStorage.removeItem(SESION_KEY); localStorage.removeItem(SESION_KEY); } catch (e) {}
  },

  // POST con tiempo límite. Reintenta solo lo que es seguro repetir (lecturas) o
  // los límites de Google, que se rechazan antes de tocar ningún dato.
  async post(cuerpo, opciones) {
    const op = Object.assign({ intentos: 1, timeoutMs: 60000 }, opciones || {});
    let ultimoError;
    for (let i = 0; i < op.intentos; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), op.timeoutMs);
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ sessionToken: Api.token() }, cuerpo)),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const datos = await res.json();
        if (datos && datos.sessionExpired) {
          Api.borrarToken();
          window.dispatchEvent(new CustomEvent('naken-sesion-vencida'));
          throw new Error('La sesión venció. Volvé a ingresar.');
        }
        if (datos && datos.ok === false && i < op.intentos - 1 &&
            /LockService|Lock timeout|too many|demasiad[ao]s|simult/i.test(String(datos.error || ''))) {
          ultimoError = new Error(datos.error);
          await new Promise(r => setTimeout(r, 1500 * (i + 1)));
          continue;
        }
        return datos;
      } catch (err) {
        ultimoError = err && err.name === 'AbortError' ? new Error('El servidor tardó demasiado en responder.') : err;
        if (/sesión venció/.test(String(ultimoError.message))) throw ultimoError;
        if (i < op.intentos - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw ultimoError || new Error('No se pudo conectar con el servidor.');
  },

  async login(usuario, clave) {
    const d = await Api.post({ action: 'login', username: usuario, password: clave, masterToken: API_TOKEN_PUBLICO }, { intentos: 2 });
    if (!d.ok) return d;
    if (d.role !== 'admin') return { ok: false, error: 'Este módulo es solo para la administración.' };
    return d;
  },

  async cargar(mantenimientoDe) {
    const d = await Api.post({ action: 'contratacionesCargar', mantenimientoDe: mantenimientoDe || '' }, { intentos: 3 });
    if (!d.ok) throw new Error(d.error || 'No se pudieron cargar los datos.');
    return d;
  },

  async mantenimiento(edificioId) {
    const d = await Api.post({ action: 'contratacionesCargar', mantenimientoDe: edificioId }, { intentos: 3 });
    if (!d.ok) throw new Error(d.error || 'No se pudo leer el historial de mantenimiento.');
    return d.mantenimiento || [];
  },

  async guardarExpediente(exp, versionBase) {
    return Api.post({ action: 'contratacionesGuardarExpediente', expediente: exp, versionBase: versionBase || 0 }, { intentos: 1, timeoutMs: 90000 });
  },

  async guardarConfig(tipo, valor) {
    const d = await Api.post({ action: 'contratacionesGuardarConfig', tipo, valor }, { intentos: 1 });
    if (!d.ok) throw new Error(d.error || 'No se pudo guardar.');
    return d;
  },

  // Sube un archivo al Drive de la administración, sin enlace público.
  subirArchivo(file, subcarpeta) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('Sin archivo')); return; }
      if (file.size > 15 * 1024 * 1024) { reject(new Error('El archivo pesa más de 15 MB.')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.onload = async () => {
        try {
          const d = await Api.post({
            action: 'uploadFile', privado: true,
            filename: file.name || ('archivo-' + Date.now()),
            mimeType: file.type || 'application/octet-stream',
            data: String(reader.result).split(',')[1],
            subfolder: subcarpeta || 'Contrataciones',
          }, { intentos: 1, timeoutMs: 120000 });
          if (d.ok && d.url) resolve(d.url); else reject(new Error(d.error || 'No se pudo subir el archivo.'));
        } catch (err) { reject(err); }
      };
      reader.readAsDataURL(file);
    });
  },
};
