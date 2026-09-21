/* ==========================================================================
   NAKEN · Contrataciones — auth-gate.js
   Bloqueo de acceso client-side. No es seguridad real (el repo puede ser
   público): es un filtro para que nadie que abra el link entre sin clave.
   Hash SHA-256 vía Web Crypto API, sin dependencias externas.
   ========================================================================== */

const AUTH_STORAGE_KEY = 'naken_contrataciones_auth';
const AUTH_REMEMBER_KEY = 'naken_contrataciones_remember';

// Hash SHA-256 por defecto de la clave "Contratar#NK26".
// Para cambiarla: abrir la consola del navegador y ejecutar
//   await hashClave("NuevaClave")
// y reemplazar el valor de AUTH_HASH_DEFAULT por el resultado.
const AUTH_HASH_DEFAULT = '37ceac5bfc5914abcdc832a99dbddbf7a15e83cad4f9dbbfe239dd499881275e';

async function hashClave(texto) {
  const enc = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getHashConfigurado() {
  return localStorage.getItem(AUTH_STORAGE_KEY) || AUTH_HASH_DEFAULT;
}

function estaDesbloqueado() {
  return sessionStorage.getItem('naken_unlocked') === '1' ||
         localStorage.getItem(AUTH_REMEMBER_KEY) === '1';
}

function desbloquear(recordar) {
  sessionStorage.setItem('naken_unlocked', '1');
  if (recordar) localStorage.setItem(AUTH_REMEMBER_KEY, '1');
}

function bloquear() {
  sessionStorage.removeItem('naken_unlocked');
  localStorage.removeItem(AUTH_REMEMBER_KEY);
  location.reload();
}

async function intentarIngreso(clave, recordar) {
  const hash = await hashClave(clave);
  const configurado = getHashConfigurado();
  if (hash === configurado) {
    desbloquear(recordar);
    return true;
  }
  return false;
}

function mostrarApp() {
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('app-root').style.display = 'flex';
  document.body.classList.remove('locked');
  if (typeof initApp === 'function') initApp();
}

function mostrarGate() {
  document.getElementById('auth-gate').style.display = 'flex';
  document.getElementById('app-root').style.display = 'none';
  document.body.classList.add('locked');
}

document.addEventListener('DOMContentLoaded', () => {
  if (estaDesbloqueado()) {
    mostrarApp();
  } else {
    mostrarGate();
  }

  const form = document.getElementById('auth-form');
  const input = document.getElementById('auth-clave');
  const chk = document.getElementById('auth-recordar');
  const err = document.getElementById('auth-error');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const ok = await intentarIngreso(input.value, chk.checked);
    if (ok) {
      mostrarApp();
    } else {
      err.textContent = 'Clave incorrecta. Intente nuevamente.';
      input.value = '';
      input.focus();
      const card = document.querySelector('.auth-card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    }
  });

  const btnLock = document.getElementById('btn-lock');
  if (btnLock) btnLock.addEventListener('click', bloquear);
});
