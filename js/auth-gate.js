/* ==========================================================================
   NAKEN · Contrataciones — auth-gate.js
   Ingreso con el usuario y la clave de ADMINISTRADOR de la app principal.
   La validación la hace el servidor (antes era una clave fija escrita en este
   archivo, visible para cualquiera y salteable desde el navegador).
   ========================================================================== */

function mostrarApp() {
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('app-root').style.display = 'flex';
  document.body.classList.remove('locked');
  if (typeof initApp === 'function') initApp();
}

function mostrarGate(mensaje) {
  document.getElementById('auth-gate').style.display = 'flex';
  document.getElementById('app-root').style.display = 'none';
  document.body.classList.add('locked');
  const err = document.getElementById('auth-error');
  if (err) err.textContent = mensaje || '';
}

function bloquear() {
  Api.borrarToken();
  location.reload();
}

document.addEventListener('DOMContentLoaded', () => {
  if (Api.token()) mostrarApp(); else mostrarGate();

  window.addEventListener('naken-sesion-vencida', () => mostrarGate('La sesión venció. Volvé a ingresar.'));

  const form = document.getElementById('auth-form');
  const usuario = document.getElementById('auth-usuario');
  const clave = document.getElementById('auth-clave');
  const chk = document.getElementById('auth-recordar');
  const err = document.getElementById('auth-error');
  const btn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (btn.disabled) return;
    err.textContent = '';
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Ingresando…';
    try {
      const d = await Api.login(usuario.value.trim(), clave.value);
      if (d.ok) {
        Api.guardarToken(d.sessionToken, chk.checked);
        clave.value = '';
        mostrarApp();
        return;
      }
      err.textContent = d.error || 'Usuario o clave incorrectos.';
      clave.value = '';
      clave.focus();
      const card = document.querySelector('.auth-card');
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    } catch (e) {
      err.textContent = 'No se pudo conectar con el servidor: ' + (e && e.message ? e.message : e);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  const btnLock = document.getElementById('btn-lock');
  if (btnLock) btnLock.addEventListener('click', bloquear);
});
