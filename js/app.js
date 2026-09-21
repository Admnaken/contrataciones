/* ==========================================================================
   NAKEN · Contrataciones — app.js
   Lógica principal: estado, persistencia (localStorage), router por hash
   y render de cada panel.
   ========================================================================== */

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------
const LS_KEYS = {
  consorcios: 'naken_contrataciones_consorcios',
  expedientes: 'naken_contrataciones_expedientes',
  admin: 'naken_contrataciones_admin',
};

function loadConsorcios() { return JSON.parse(localStorage.getItem(LS_KEYS.consorcios) || '[]'); }
function saveConsorcios(arr) { localStorage.setItem(LS_KEYS.consorcios, JSON.stringify(arr)); }
function loadExpedientes() { return JSON.parse(localStorage.getItem(LS_KEYS.expedientes) || '[]'); }
function saveExpedientes(arr) { localStorage.setItem(LS_KEYS.expedientes, JSON.stringify(arr)); }
function loadAdmin() {
  return JSON.parse(localStorage.getItem(LS_KEYS.admin) || 'null') || {
    nombre: 'Lic. Sebastián Rubén Espeche', matricula: '20.066', email: '', telefono: ''
  };
}
function saveAdmin(a) { localStorage.setItem(LS_KEYS.admin, JSON.stringify(a)); }

function getConsorcio(id) { return loadConsorcios().find(c => c.id === id); }
function getExpediente(id) { return loadExpedientes().find(e => e.id === id); }
function updateExpediente(exp) {
  exp.actualizado = new Date().toISOString();
  const arr = loadExpedientes();
  const idx = arr.findIndex(e => e.id === exp.id);
  if (idx >= 0) arr[idx] = exp; else arr.push(exp);
  saveExpedientes(arr);
}
function logExpediente(exp, texto) {
  exp.historial = exp.historial || [];
  exp.historial.unshift({ fecha: new Date().toISOString(), texto });
}

// ---------------------------------------------------------------------------
// Progreso / completitud por fase
// ---------------------------------------------------------------------------
function presupuestoSeleccionado(exp) {
  return (exp.presupuestos || []).find(p => p.id === exp.proveedorSeleccionadoId) || null;
}

function fase1Completa(exp) {
  const p = presupuestoSeleccionado(exp);
  if (!p) return false;
  return REQUISITOS_PRESUPUESTO.every(r => !!p.requisitos[r.id]);
}

function fase2Completa(exp) {
  const v = exp.validacionFiscal || {};
  if (!v.cuitActivo || !v.apocOk || !v.impuestosOk) return false;
  if (v.matriculaAplica && !v.matriculaOk) return false;
  return true;
}

function fase3Completa(exp) {
  const i = exp.instrumentacion || {};
  if (!i.tipo) return false;
  if (i.tipo === TIPO_INSTRUMENTACION.CONTRATO) {
    return CLAUSULAS_CONTRATO.every(c => !!i.clausulas[c.id]);
  }
  return true;
}

function fase4Completa(exp) {
  const c = exp.complianceLaboral || {};
  if (!c.tipoPrestador) return false;
  const lista = c.tipoPrestador === TIPO_PRESTADOR.MONOTRIBUTISTA ? DOC_LABORAL_MONOTRIBUTISTA : DOC_LABORAL_EMPRESA;
  return lista.every(d => !!(c.documentos || {})[d.id]);
}

function fase5Completa(exp) {
  const p = exp.pago || {};
  if (!p.caeValidado) return false;
  if (!p.medioPago || !MEDIOS_PAGO_VALIDOS.includes(p.medioPago)) return false;
  return true;
}

function puedeVistoBuenoContratacion(exp) {
  return fase1Completa(exp) && fase2Completa(exp) && fase3Completa(exp) && fase4Completa(exp);
}
function puedeVistoBuenoPago(exp) {
  return exp.vistoBuenoContratacion.aprobado && fase5Completa(exp);
}

function recalcularEstado(exp) {
  if (exp.vistoBuenoPago.aprobado) { exp.estado = ESTADO_EXPEDIENTE.PAGADO; return; }
  if (exp.vistoBuenoContratacion.aprobado) {
    exp.estado = fase5Completa(exp) ? ESTADO_EXPEDIENTE.LISTO_PARA_PAGAR : ESTADO_EXPEDIENTE.EN_EJECUCION;
    return;
  }
  if (puedeVistoBuenoContratacion(exp)) { exp.estado = ESTADO_EXPEDIENTE.LISTO_PARA_CONTRATAR; return; }
  if (!fase1Completa(exp)) { exp.estado = exp.presupuestos.length ? ESTADO_EXPEDIENTE.EN_VALIDACION : ESTADO_EXPEDIENTE.EN_PRESUPUESTOS; return; }
  if (!fase2Completa(exp)) { exp.estado = ESTADO_EXPEDIENTE.EN_VALIDACION; return; }
  if (!fase3Completa(exp)) { exp.estado = ESTADO_EXPEDIENTE.EN_INSTRUMENTACION; return; }
  if (!fase4Completa(exp)) { exp.estado = ESTADO_EXPEDIENTE.EN_COMPLIANCE_LABORAL; return; }
  exp.estado = ESTADO_EXPEDIENTE.LISTO_PARA_CONTRATAR;
}

function progresoPct(exp) {
  const fases = [fase1Completa(exp), fase2Completa(exp), fase3Completa(exp), fase4Completa(exp), fase5Completa(exp)];
  const base = fases.filter(Boolean).length / fases.length * 80;
  const extra = (exp.vistoBuenoContratacion.aprobado ? 10 : 0) + (exp.vistoBuenoPago.aprobado ? 10 : 0);
  return Math.round(base + extra);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function initApp() {
  if (!window.location.hash) window.location.hash = '#/dashboard';
  window.addEventListener('hashchange', render);
  render();
}

function render() {
  const hashSinQuery = window.location.hash.split('?')[0];
  const hash = hashSinQuery.replace('#/', '');
  const [ruta, param] = hash.split('/');
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  const navActivo = document.querySelector(`.nav-link[data-ruta="${ruta}"]`);
  if (navActivo) navActivo.classList.add('active');

  const main = document.getElementById('main-content');
  try {
    if (ruta === 'dashboard' || !ruta) main.innerHTML = viewDashboard();
    else if (ruta === 'consorcios') main.innerHTML = viewConsorcios();
    else if (ruta === 'admin') main.innerHTML = viewAdmin();
    else if (ruta === 'expediente' && param === 'nuevo') main.innerHTML = viewExpedienteNuevo();
    else if (ruta === 'expediente' && param) main.innerHTML = viewExpedienteDetalle(param);
    else main.innerHTML = viewDashboard();
  } catch (e) {
    main.innerHTML = `<div class="empty-state"><h2>Ocurrió un error al renderizar</h2><p>${e.message}</p></div>`;
    console.error(e);
  }
  window.scrollTo(0, 0);
}

function ir(ruta) { window.location.hash = '#/' + ruta; }

// ---------------------------------------------------------------------------
// Badge de estado
// ---------------------------------------------------------------------------
function badgeEstado(estado) {
  const meta = ESTADO_META[estado] || { label: estado, color: 'slate' };
  return `<span class="badge badge-${meta.color}">${meta.label}</span>`;
}

function barraProgreso(pct) {
  return `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`;
}

// ---------------------------------------------------------------------------
// VIEW: Dashboard
// ---------------------------------------------------------------------------
function viewDashboard() {
  const expedientes = loadExpedientes();
  const consorcios = loadConsorcios();
  expedientes.forEach(recalcularEstado);

  if (!consorcios.length) {
    return `
    <div class="page-header"><h1>Panel de contrataciones</h1><p>Circuito de contratación de servicios de mantenimiento — Protocolo Ley 941 / Disp. 856/14.</p></div>
    <div class="empty-state">
      <div class="empty-icon">🏢</div>
      <h2>Empezá dando de alta un consorcio</h2>
      <p>Necesitás al menos un consorcio cargado para poder abrir expedientes de contratación.</p>
      <button class="btn btn-primary" onclick="ir('consorcios')">Ir a Consorcios</button>
    </div>`;
  }

  const alertas = generarAlertas(expedientes);

  const activos = expedientes.filter(e => e.estado !== ESTADO_EXPEDIENTE.PAGADO && e.estado !== ESTADO_EXPEDIENTE.CERRADO && e.estado !== ESTADO_EXPEDIENTE.RECHAZADO);
  const cerrados = expedientes.filter(e => e.estado === ESTADO_EXPEDIENTE.PAGADO || e.estado === ESTADO_EXPEDIENTE.CERRADO);

  const kpis = [
    { label: 'Expedientes activos', valor: activos.length },
    { label: 'Esperando VB de contratación', valor: expedientes.filter(e => e.estado === ESTADO_EXPEDIENTE.LISTO_PARA_CONTRATAR).length },
    { label: 'Esperando VB de pago', valor: expedientes.filter(e => e.estado === ESTADO_EXPEDIENTE.LISTO_PARA_PAGAR).length },
    { label: 'Cerrados / pagados', valor: cerrados.length },
  ];

  return `
  <div class="page-header">
    <h1>Panel de contrataciones</h1>
    <p>Circuito de contratación de servicios de mantenimiento — Protocolo Ley 941 / Disp. 856/14.</p>
    <button class="btn btn-primary" onclick="ir('expediente/nuevo')">+ Nuevo expediente</button>
  </div>

  <div class="kpi-row">
    ${kpis.map(k => `<div class="kpi-card"><div class="kpi-valor">${k.valor}</div><div class="kpi-label">${k.label}</div></div>`).join('')}
  </div>

  ${alertas.length ? `<div class="alertas-panel">
    <h3>Alertas y vencimientos</h3>
    ${alertas.map(a => `<div class="alerta alerta-${a.nivel}"><span>${a.icono}</span><div><strong>${a.titulo}</strong><p>${a.texto}</p></div></div>`).join('')}
  </div>` : ''}

  <h3 class="section-title">Expedientes activos</h3>
  ${activos.length ? `<div class="tabla-expedientes">${activos.map(e => filaExpediente(e, consorcios)).join('')}</div>`
    : `<div class="empty-state-mini">No hay expedientes activos. <a href="#/expediente/nuevo">Crear el primero</a>.</div>`}

  ${cerrados.length ? `<h3 class="section-title">Historial</h3><div class="tabla-expedientes">${cerrados.map(e => filaExpediente(e, consorcios)).join('')}</div>` : ''}
  `;
}

function generarAlertas(expedientes) {
  const alertas = [];
  expedientes.forEach(e => {
    if (e.estado === ESTADO_EXPEDIENTE.PAGADO || e.estado === ESTADO_EXPEDIENTE.CERRADO) return;
    const p = presupuestoSeleccionado(e);
    if (p) {
      const dias = diasHabilesDesde(p.recibido.slice(0, 10));
      if (dias !== null && dias >= 15 && !e.vistoBuenoContratacion.aprobado) {
        alertas.push({ nivel: 'amber', icono: '⏱️', titulo: `Oferta posiblemente vencida — ${e.tipoServicio || 'expediente'}`,
          texto: `Pasaron ${dias} días hábiles desde la recepción del presupuesto (validez sugerida: 15 días). Revisar vigencia antes de contratar.` });
      }
    }
    if (e.estado === ESTADO_EXPEDIENTE.LISTO_PARA_CONTRATAR) {
      alertas.push({ nivel: 'blue', icono: '✅', titulo: `Listo para Visto Bueno de contratación`,
        texto: `El expediente "${e.tipoServicio || 'sin nombre'}" completó las fases 1 a 4 y está esperando la aprobación para contratar.` });
    }
    if (e.estado === ESTADO_EXPEDIENTE.LISTO_PARA_PAGAR) {
      alertas.push({ nivel: 'gold', icono: '💳', titulo: `Listo para Visto Bueno de pago`,
        texto: `El expediente "${e.tipoServicio || 'sin nombre'}" completó la Fase 5 y está esperando la liberación de pago.` });
    }
    if (e.complianceLaboral && e.complianceLaboral.tipoPrestador === TIPO_PRESTADOR.EMPRESA && !fase4Completa(e) && e.presupuestos.length) {
      alertas.push({ nivel: 'red', icono: '⚠️', titulo: `Riesgo Art. 30 LCT — documentación laboral incompleta`,
        texto: `Falta documentación laboral/previsional del contratista en "${e.tipoServicio || 'expediente'}". No debe iniciarse la tarea sin ella.` });
    }
  });
  return alertas;
}

function filaExpediente(e, consorcios) {
  const cons = consorcios.find(c => c.id === e.consorcioId);
  const p = presupuestoSeleccionado(e);
  return `
  <a class="fila-exp" href="#/expediente/${e.id}">
    <div class="fila-exp-main">
      <strong>${e.tipoServicio || 'Servicio sin nombre'}</strong>
      <span class="fila-exp-sub">${cons ? cons.nombre : 'Consorcio no encontrado'} · ${e.areaInstalacion || '-'}</span>
    </div>
    <div class="fila-exp-monto">${p ? fmtMoneda(p.monto) : '—'}</div>
    <div class="fila-exp-progreso">${barraProgreso(progresoPct(e))}</div>
    <div class="fila-exp-estado">${badgeEstado(e.estado)}</div>
  </a>`;
}

// ---------------------------------------------------------------------------
// VIEW: Consorcios
// ---------------------------------------------------------------------------
function viewConsorcios() {
  const consorcios = loadConsorcios();
  return `
  <div class="page-header"><h1>Consorcios</h1><p>Datos base usados para generar emails, contratos y actas.</p></div>
  <div class="grid-2">
    <div class="card">
      <h3>Nuevo consorcio</h3>
      <form onsubmit="crearConsorcio(event)">
        <label>Nombre / alias<input required name="nombre" placeholder="ej: Talcahuano 1234"></label>
        <label>Dirección completa<input required name="direccion" placeholder="Talcahuano 1234, CABA"></label>
        <label>CUIT del consorcio<input required name="cuit" placeholder="30-XXXXXXXX-X"></label>
        <button class="btn btn-primary" type="submit">Agregar consorcio</button>
      </form>
    </div>
    <div class="card">
      <h3>Consorcios cargados</h3>
      ${consorcios.length ? `<ul class="lista-simple">${consorcios.map(c => `
        <li>
          <div><strong>${c.nombre}</strong><br><span class="text-muted">${c.direccion} · CUIT ${c.cuit}</span></div>
          <button class="btn btn-ghost btn-sm" onclick="eliminarConsorcio('${c.id}')">Eliminar</button>
        </li>`).join('')}</ul>` : `<p class="text-muted">Todavía no cargaste ningún consorcio.</p>`}
    </div>
  </div>`;
}

function crearConsorcio(ev) {
  ev.preventDefault();
  const f = ev.target;
  const consorcios = loadConsorcios();
  consorcios.push({ id: 'con_' + Date.now().toString(36), nombre: f.nombre.value, direccion: f.direccion.value, cuit: f.cuit.value });
  saveConsorcios(consorcios);
  render();
}
function eliminarConsorcio(id) {
  if (!confirm('¿Eliminar este consorcio? Los expedientes asociados no se borran, pero quedarán sin consorcio vinculado.')) return;
  saveConsorcios(loadConsorcios().filter(c => c.id !== id));
  render();
}

// ---------------------------------------------------------------------------
// VIEW: Datos del administrador
// ---------------------------------------------------------------------------
function viewAdmin() {
  const a = loadAdmin();
  return `
  <div class="page-header"><h1>Datos del administrador</h1><p>Se usan para firmar emails, contratos y actas generadas.</p></div>
  <div class="card card-narrow">
    <form onsubmit="guardarAdmin(event)">
      <label>Nombre completo<input required name="nombre" value="${a.nombre}"></label>
      <label>Matrícula RPA CABA<input required name="matricula" value="${a.matricula}"></label>
      <label>Email<input type="email" name="email" value="${a.email || ''}"></label>
      <label>Teléfono<input name="telefono" value="${a.telefono || ''}"></label>
      <button class="btn btn-primary" type="submit">Guardar</button>
    </form>
  </div>`;
}
function guardarAdmin(ev) {
  ev.preventDefault();
  const f = ev.target;
  saveAdmin({ nombre: f.nombre.value, matricula: f.matricula.value, email: f.email.value, telefono: f.telefono.value });
  alert('Datos guardados.');
  render();
}

// ---------------------------------------------------------------------------
// VIEW: Nuevo expediente
// ---------------------------------------------------------------------------
function viewExpedienteNuevo() {
  const consorcios = loadConsorcios();
  if (!consorcios.length) {
    return `<div class="empty-state"><h2>Primero cargá un consorcio</h2><button class="btn btn-primary" onclick="ir('consorcios')">Ir a Consorcios</button></div>`;
  }
  return `
  <div class="page-header"><h1>Nuevo expediente de contratación</h1><p>Fase 1 — Solicitud de presupuesto (Ley 941 / Disp. 856/14).</p></div>
  <div class="card card-narrow">
    <form onsubmit="crearExpediente(event)">
      <label>Consorcio
        <select required name="consorcioId">${consorcios.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}</select>
      </label>
      <label>Servicio / rubro<input required name="tipoServicio" placeholder="ej: Mantenimiento de ascensores"></label>
      <label>Área o instalación<input required name="areaInstalacion" placeholder="ej: Ascensor palier / Fachada / Sala de bombas"></label>
      <label>Tipo de mantenimiento
        <select name="tipoMantenimiento"><option value="preventivo">Preventivo</option><option value="correctivo">Correctivo</option></select>
      </label>
      <label>Detalle de los trabajos requeridos<textarea name="descripcion" rows="4" placeholder="Descripción sumaria para incluir en el email de pedido de presupuesto"></textarea></label>
      <label>Fecha límite para recibir ofertas<input type="date" name="fechaLimiteOferta"></label>
      <button class="btn btn-primary" type="submit">Crear expediente</button>
    </form>
  </div>`;
}

function crearExpediente(ev) {
  ev.preventDefault();
  const f = ev.target;
  const exp = nuevoExpediente({
    consorcioId: f.consorcioId.value,
    tipoServicio: f.tipoServicio.value,
    areaInstalacion: f.areaInstalacion.value,
    tipoMantenimiento: f.tipoMantenimiento.value,
    descripcion: f.descripcion.value,
    fechaLimiteOferta: f.fechaLimiteOferta.value,
    estado: ESTADO_EXPEDIENTE.EN_PRESUPUESTOS,
  });
  updateExpediente(exp);
  ir('expediente/' + exp.id);
}

// ---------------------------------------------------------------------------
// VIEW: Detalle de expediente (tabs F1-F5 + vistos buenos)
// ---------------------------------------------------------------------------
function viewExpedienteDetalle(id) {
  const exp = getExpediente(id);
  if (!exp) return `<div class="empty-state"><h2>Expediente no encontrado</h2></div>`;
  recalcularEstado(exp);
  updateExpediente(exp);
  const consorcio = getConsorcio(exp.consorcioId);
  const admin = loadAdmin();

  const tab = window.location.hash.split('?')[1]?.replace('tab=', '') || 'f1';

  const tabsDef = [
    { id: 'f1', label: '1 · Presupuesto', done: fase1Completa(exp) },
    { id: 'f2', label: '2 · Validación fiscal', done: fase2Completa(exp) },
    { id: 'f3', label: '3 · Instrumentación', done: fase3Completa(exp) },
    { id: 'f4', label: '4 · Laboral', done: fase4Completa(exp) },
    { id: 'f5', label: '5 · Pago', done: fase5Completa(exp) },
    { id: 'vb', label: 'Vistos buenos', done: exp.vistoBuenoContratacion.aprobado && exp.vistoBuenoPago.aprobado },
  ];

  let contenidoTab = '';
  if (tab === 'f1') contenidoTab = tabPresupuestos(exp, consorcio, admin);
  else if (tab === 'f2') contenidoTab = tabValidacionFiscal(exp);
  else if (tab === 'f3') contenidoTab = tabInstrumentacion(exp, consorcio, admin);
  else if (tab === 'f4') contenidoTab = tabComplianceLaboral(exp);
  else if (tab === 'f5') contenidoTab = tabPago(exp);
  else if (tab === 'vb') contenidoTab = tabVistosBuenos(exp, consorcio);

  return `
  <div class="page-header expediente-header">
    <div>
      <a class="volver" href="#/dashboard">← Panel</a>
      <h1>${exp.tipoServicio || 'Expediente sin nombre'}</h1>
      <p>${consorcio ? consorcio.nombre + ' · ' + consorcio.direccion : 'Consorcio no encontrado'}</p>
    </div>
    <div class="expediente-header-right">
      ${badgeEstado(exp.estado)}
      ${barraProgreso(progresoPct(exp))}
    </div>
  </div>

  <div class="tabs">
    ${tabsDef.map(t => `<a class="tab ${tab === t.id ? 'active' : ''}" href="#/expediente/${exp.id}?tab=${t.id}">
      ${t.done ? '<span class="tab-check">✓</span>' : ''}${t.label}</a>`).join('')}
  </div>

  <div class="tab-content">${contenidoTab}</div>
  `;
}

// --- Tab: Fase 1 — presupuestos --------------------------------------------
function tabPresupuestos(exp, consorcio, admin) {
  const email = generarEmailPresupuesto(exp, consorcio, admin);
  return `
  <div class="grid-2">
    <div class="card">
      <h3>Email de pedido de presupuesto</h3>
      <p class="text-muted">Generado según Ley 941 y Disp. 856/14. Completá los datos del proveedor antes de enviarlo.</p>
      <pre class="preview-text">${email.replace(/</g, '&lt;')}</pre>
      <button class="btn btn-secondary" onclick='copiarAlPortapapeles(${JSON.stringify(email)}, this)'>Copiar email</button>
    </div>
    <div class="card">
      <h3>Cargar presupuesto recibido</h3>
      <form onsubmit="agregarPresupuesto(event, '${exp.id}')">
        <label>Proveedor / Razón social<input required name="proveedorNombre"></label>
        <label>CUIT<input required name="proveedorCuit" placeholder="30-XXXXXXXX-X"></label>
        <label>Email<input type="email" name="proveedorEmail"></label>
        <label>Teléfono<input name="proveedorTelefono"></label>
        <label>Monto cotizado (ARS)<input required type="number" step="0.01" name="monto"></label>
        <label>Archivo del presupuesto (PDF)<input type="file" name="archivo" accept=".pdf,.jpg,.png"></label>
        <button class="btn btn-primary" type="submit">Agregar presupuesto</button>
      </form>
    </div>
  </div>

  <h3 class="section-title">Presupuestos recibidos (${exp.presupuestos.length})</h3>
  ${exp.presupuestos.length ? exp.presupuestos.map(p => cardPresupuesto(exp, p)).join('') :
    `<div class="empty-state-mini">Todavía no se cargó ningún presupuesto.</div>`}
  `;
}

function cardPresupuesto(exp, p) {
  const completos = REQUISITOS_PRESUPUESTO.filter(r => p.requisitos[r.id]).length;
  const total = REQUISITOS_PRESUPUESTO.length;
  const ok = completos === total;
  const esSeleccionado = exp.proveedorSeleccionadoId === p.id;
  return `
  <div class="card presupuesto-card ${esSeleccionado ? 'presupuesto-seleccionado' : ''}">
    <div class="presupuesto-head">
      <div>
        <strong>${p.proveedorNombre}</strong> <span class="text-muted">CUIT ${p.proveedorCuit}</span>
        <div class="text-muted">${fmtMoneda(p.monto)} · recibido ${fmtFecha(p.recibido.slice(0,10))}</div>
      </div>
      <div class="presupuesto-actions">
        <span class="badge ${ok ? 'badge-green' : 'badge-amber'}">${completos}/${total} requisitos</span>
        ${esSeleccionado ? '<span class="badge badge-teal">Seleccionado</span>' :
          `<button class="btn btn-sm btn-secondary" onclick="seleccionarPresupuesto('${exp.id}','${p.id}')">Seleccionar</button>`}
        <button class="btn btn-sm btn-ghost" onclick="eliminarPresupuesto('${exp.id}','${p.id}')">Eliminar</button>
      </div>
    </div>
    <div class="checklist">
      ${REQUISITOS_PRESUPUESTO.map(r => `
        <label class="check-item">
          <input type="checkbox" ${p.requisitos[r.id] ? 'checked' : ''} onchange="toggleRequisitoPresupuesto('${exp.id}','${p.id}','${r.id}', this.checked)">
          <div><strong>${r.label}</strong><span>${r.detalle}</span></div>
        </label>`).join('')}
    </div>
  </div>`;
}

function agregarPresupuesto(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const exp = getExpediente(expId);
  const file = f.archivo.files[0];
  const guardar = (dataUrl, nombre) => {
    const p = nuevoPresupuesto({
      proveedorNombre: f.proveedorNombre.value, proveedorCuit: f.proveedorCuit.value,
      proveedorEmail: f.proveedorEmail.value, proveedorTelefono: f.proveedorTelefono.value,
      monto: parseFloat(f.monto.value) || 0, archivoNombre: nombre || '', archivoDataUrl: dataUrl || '',
    });
    exp.presupuestos.push(p);
    logExpediente(exp, `Presupuesto cargado: ${p.proveedorNombre} — ${fmtMoneda(p.monto)}.`);
    updateExpediente(exp);
    render();
  };
  if (file) {
    const reader = new FileReader();
    reader.onload = () => guardar(reader.result, file.name);
    reader.readAsDataURL(file);
  } else {
    guardar('', '');
  }
}

function toggleRequisitoPresupuesto(expId, presId, reqId, valor) {
  const exp = getExpediente(expId);
  const p = exp.presupuestos.find(x => x.id === presId);
  p.requisitos[reqId] = valor;
  updateExpediente(exp);
  render();
}

function seleccionarPresupuesto(expId, presId) {
  const exp = getExpediente(expId);
  exp.proveedorSeleccionadoId = presId;
  const p = exp.presupuestos.find(x => x.id === presId);
  logExpediente(exp, `Proveedor seleccionado: ${p.proveedorNombre}.`);
  updateExpediente(exp);
  render();
}

function eliminarPresupuesto(expId, presId) {
  if (!confirm('¿Eliminar este presupuesto?')) return;
  const exp = getExpediente(expId);
  exp.presupuestos = exp.presupuestos.filter(p => p.id !== presId);
  if (exp.proveedorSeleccionadoId === presId) exp.proveedorSeleccionadoId = null;
  updateExpediente(exp);
  render();
}

// --- Tab: Fase 2 — validación fiscal ----------------------------------------
function tabValidacionFiscal(exp) {
  const v = exp.validacionFiscal || {};
  const p = presupuestoSeleccionado(exp);
  if (!p) return `<div class="empty-state-mini">Primero seleccioná un presupuesto en la Fase 1.</div>`;
  return `
  <div class="card card-narrow">
    <h3>Compliance fiscal y técnico — ${p.proveedorNombre}</h3>
    <p class="text-muted">Verificaciones ante ARCA, base APOC, AGIP y habilitación matricular AGC/SART.</p>
    <form onsubmit="guardarValidacionFiscal(event, '${exp.id}')">
      ${VALIDACION_FISCAL_CAMPOS.map(c => campoFormulario(c, v)).join('')}
      <button class="btn btn-primary" type="submit">Guardar validación</button>
    </form>
  </div>`;
}

function campoFormulario(campo, valores) {
  const val = valores[campo.id];
  if (campo.tipo === 'bool') {
    return `<label class="check-item check-item-form">
      <input type="checkbox" name="${campo.id}" ${val ? 'checked' : ''}>
      <div><strong>${campo.label}</strong>${campo.ayuda ? `<span>${campo.ayuda}</span>` : ''}</div>
    </label>`;
  }
  if (campo.tipo === 'select') {
    return `<label>${campo.label}<select name="${campo.id}">
      ${campo.opciones.map(o => `<option ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
    </select></label>`;
  }
  return `<label>${campo.label}<input name="${campo.id}" value="${val || ''}" placeholder="${campo.placeholder || ''}"></label>`;
}

function guardarValidacionFiscal(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const exp = getExpediente(expId);
  const v = {};
  VALIDACION_FISCAL_CAMPOS.forEach(c => {
    if (c.tipo === 'bool') v[c.id] = f[c.id].checked;
    else v[c.id] = f[c.id].value;
  });
  exp.validacionFiscal = v;
  logExpediente(exp, 'Validación fiscal actualizada.');
  updateExpediente(exp);
  render();
}

// --- Tab: Fase 3 — instrumentación jurídica ---------------------------------
function tabInstrumentacion(exp, consorcio, admin) {
  const i = exp.instrumentacion || {};
  const p = presupuestoSeleccionado(exp);
  if (!p) return `<div class="empty-state-mini">Primero seleccioná un presupuesto en la Fase 1.</div>`;
  const contratoTexto = generarContratoLocacion(exp, consorcio, admin, p);
  return `
  <div class="card card-narrow">
    <h3>Encuadre normativo</h3>
    <form onsubmit="guardarTipoInstrumentacion(event,'${exp.id}')">
      <label class="radio-item"><input type="radio" name="tipo" value="${TIPO_INSTRUMENTACION.PRESUPUESTO}" ${i.tipo === TIPO_INSTRUMENTACION.PRESUPUESTO ? 'checked' : ''}>
        <div><strong>Presupuesto aprobado</strong><span>Trabajos puntuales o menores. Constituye acuerdo vinculante según Ley 941.</span></div></label>
      <label class="radio-item"><input type="radio" name="tipo" value="${TIPO_INSTRUMENTACION.CONTRATO}" ${i.tipo === TIPO_INSTRUMENTACION.CONTRATO ? 'checked' : ''}>
        <div><strong>Contrato de locación de obra/servicios</strong><span>Obligatorio para servicios recurrentes o de envergadura (ascensores, impermeabilización, fachadas, calderas).</span></div></label>
      <button class="btn btn-primary" type="submit">Guardar encuadre</button>
    </form>
  </div>
  ${i.tipo === TIPO_INSTRUMENTACION.CONTRATO ? `
  <div class="card">
    <h3>Cláusulas mínimas e indispensables</h3>
    <div class="checklist">
      ${CLAUSULAS_CONTRATO.map(c => `
        <label class="check-item">
          <input type="checkbox" ${i.clausulas[c.id] ? 'checked' : ''} onchange="toggleClausula('${exp.id}','${c.id}', this.checked)">
          <div><strong>${c.label}</strong><span>${c.detalle}</span></div>
        </label>`).join('')}
    </div>
  </div>
  <div class="card">
    <h3>Contrato generado</h3>
    <pre class="preview-text">${contratoTexto.replace(/</g, '&lt;')}</pre>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick='copiarAlPortapapeles(${JSON.stringify(contratoTexto)}, this)'>Copiar texto</button>
      <button class="btn btn-secondary" onclick='abrirImprimible("Contrato de Locación", ${JSON.stringify(contratoTexto)})'>Ver para imprimir / PDF</button>
    </div>
  </div>` : ''}
  `;
}

function guardarTipoInstrumentacion(ev, expId) {
  ev.preventDefault();
  const tipo = ev.target.tipo.value;
  const exp = getExpediente(expId);
  exp.instrumentacion.tipo = tipo;
  logExpediente(exp, `Encuadre jurídico: ${tipo === TIPO_INSTRUMENTACION.CONTRATO ? 'Contrato de locación' : 'Presupuesto aprobado'}.`);
  updateExpediente(exp);
  render();
}
function toggleClausula(expId, clausulaId, valor) {
  const exp = getExpediente(expId);
  exp.instrumentacion.clausulas[clausulaId] = valor;
  updateExpediente(exp);
  render();
}

// --- Tab: Fase 4 — compliance laboral ---------------------------------------
function tabComplianceLaboral(exp) {
  const c = exp.complianceLaboral || {};
  const p = presupuestoSeleccionado(exp);
  if (!p) return `<div class="empty-state-mini">Primero seleccioná un presupuesto en la Fase 1.</div>`;
  const lista = c.tipoPrestador === TIPO_PRESTADOR.EMPRESA ? DOC_LABORAL_EMPRESA
              : c.tipoPrestador === TIPO_PRESTADOR.MONOTRIBUTISTA ? DOC_LABORAL_MONOTRIBUTISTA : null;
  return `
  <div class="card card-narrow">
    <h3>Tipo de prestador</h3>
    <p class="text-muted">Define la documentación exigible para neutralizar la responsabilidad solidaria (Art. 30 LCT / Art. 1753 CCyCN).</p>
    <form onsubmit="guardarTipoPrestador(event,'${exp.id}')">
      <label class="radio-item"><input type="radio" name="tipoPrestador" value="${TIPO_PRESTADOR.MONOTRIBUTISTA}" ${c.tipoPrestador === TIPO_PRESTADOR.MONOTRIBUTISTA ? 'checked' : ''}>
        <div><strong>A. Proveedor independiente (Monotributista)</strong></div></label>
      <label class="radio-item"><input type="radio" name="tipoPrestador" value="${TIPO_PRESTADOR.EMPRESA}" ${c.tipoPrestador === TIPO_PRESTADOR.EMPRESA ? 'checked' : ''}>
        <div><strong>B. Empresa / contratista con personal</strong></div></label>
      <button class="btn btn-primary" type="submit">Guardar</button>
    </form>
  </div>
  ${lista ? `
  <div class="card">
    <h3>Documentación exigida (con 48 hs. de antelación al ingreso)</h3>
    <div class="checklist">
      ${lista.map(d => `
        <label class="check-item">
          <input type="checkbox" ${(c.documentos || {})[d.id] ? 'checked' : ''} onchange="toggleDocLaboral('${exp.id}','${d.id}', this.checked)">
          <div><strong>${d.label}</strong>${d.detalle ? `<span>${d.detalle}</span>` : ''}</div>
        </label>`).join('')}
    </div>
  </div>` : ''}
  `;
}

function guardarTipoPrestador(ev, expId) {
  ev.preventDefault();
  const tipo = ev.target.tipoPrestador.value;
  const exp = getExpediente(expId);
  exp.complianceLaboral.tipoPrestador = tipo;
  exp.complianceLaboral.documentos = exp.complianceLaboral.documentos || {};
  logExpediente(exp, `Tipo de prestador: ${tipo === TIPO_PRESTADOR.EMPRESA ? 'Empresa con personal' : 'Monotributista independiente'}.`);
  updateExpediente(exp);
  render();
}
function toggleDocLaboral(expId, docId, valor) {
  const exp = getExpediente(expId);
  exp.complianceLaboral.documentos[docId] = valor;
  updateExpediente(exp);
  render();
}

// --- Tab: Fase 5 — comprobantes y pago --------------------------------------
function tabPago(exp) {
  const p = exp.pago || {};
  const prov = presupuestoSeleccionado(exp);
  if (!prov) return `<div class="empty-state-mini">Primero seleccioná un presupuesto en la Fase 1.</div>`;
  return `
  <div class="card card-narrow">
    <h3>Comprobantes, retenciones y medio de pago</h3>
    <form onsubmit="guardarPago(event,'${exp.id}')">
      <label class="check-item check-item-form">
        <input type="checkbox" name="caeValidado" ${p.caeValidado ? 'checked' : ''}>
        <div><strong>CAE / CAEA validado en ARCA</strong><span>Verificado en el sistema de validación de comprobantes previo a la orden de pago.</span></div>
      </label>
      <label>Tipo de factura
        <select name="tipoFactura"><option ${p.tipoFactura==='B'?'selected':''}>B</option><option ${p.tipoFactura==='C'?'selected':''}>C</option></select>
      </label>
      <label>Número de comprobante<input name="numeroFactura" value="${p.numeroFactura || ''}"></label>
      <label>Monto total de la factura (ARS)<input type="number" step="0.01" name="montoFactura" value="${prov.monto || 0}"></label>

      <label class="check-item check-item-form">
        <input type="checkbox" name="aplicaSUSS" ${p.aplicaSUSS ? 'checked' : ''} onchange="document.getElementById('campoSUSS').style.display=this.checked?'block':'none'">
        <div><strong>Aplica retención SUSS</strong><span>RG 1784/1785 — servicios de limpieza, seguridad y mantenimiento que superen el mínimo no imponible.</span></div>
      </label>
      <div id="campoSUSS" style="display:${p.aplicaSUSS ? 'block':'none'}">
        <label>Monto retención SUSS (ARS)<input type="number" step="0.01" name="montoRetSUSS" value="${p.montoRetSUSS || 0}"></label>
      </div>

      <label class="check-item check-item-form">
        <input type="checkbox" name="aplicaAGIP" ${p.aplicaAGIP ? 'checked' : ''} onchange="document.getElementById('campoAGIP').style.display=this.checked?'block':'none'">
        <div><strong>Aplica retención AGIP (IIBB)</strong><span>Según alícuota del padrón mensual vigente.</span></div>
      </label>
      <div id="campoAGIP" style="display:${p.aplicaAGIP ? 'block':'none'}">
        <label>Monto retención AGIP (ARS)<input type="number" step="0.01" name="montoRetAGIP" value="${p.montoRetAGIP || 0}"></label>
      </div>

      <label>Medio de pago
        <select name="medioPago">
          <option value="">Seleccionar...</option>
          ${MEDIOS_PAGO_VALIDOS.map(m => `<option ${p.medioPago === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </label>
      <p class="text-muted">⚠️ El pago en efectivo está estrictamente prohibido (Ley 25.345) e invalida la deducibilidad fiscal y la rendición de cuentas.</p>
      <button class="btn btn-primary" type="submit">Guardar y calcular</button>
    </form>
  </div>
  ${p.montoAPagar ? `<div class="card card-narrow"><h3>Monto neto a pagar</h3><div class="monto-destacado">${fmtMoneda(p.montoAPagar)}</div>
    <p class="text-muted">Factura ${fmtMoneda(prov.monto)} − Ret. SUSS ${fmtMoneda(p.montoRetSUSS)} − Ret. AGIP ${fmtMoneda(p.montoRetAGIP)}</p></div>` : ''}
  `;
}

function guardarPago(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const exp = getExpediente(expId);
  const montoFactura = parseFloat(f.montoFactura.value) || 0;
  const retSUSS = f.aplicaSUSS.checked ? (parseFloat(f.montoRetSUSS.value) || 0) : 0;
  const retAGIP = f.aplicaAGIP.checked ? (parseFloat(f.montoRetAGIP.value) || 0) : 0;
  exp.pago = {
    caeValidado: f.caeValidado.checked,
    tipoFactura: f.tipoFactura.value,
    numeroFactura: f.numeroFactura.value,
    aplicaSUSS: f.aplicaSUSS.checked, montoRetSUSS: retSUSS,
    aplicaAGIP: f.aplicaAGIP.checked, montoRetAGIP: retAGIP,
    medioPago: f.medioPago.value,
    montoAPagar: montoFactura - retSUSS - retAGIP,
  };
  logExpediente(exp, 'Datos de pago actualizados.');
  updateExpediente(exp);
  render();
}

// --- Tab: Vistos buenos ------------------------------------------------------
function tabVistosBuenos(exp, consorcio) {
  const puedeContratar = puedeVistoBuenoContratacion(exp);
  const puedePagar = puedeVistoBuenoPago(exp);
  const resumen = generarResumenExpediente(exp, consorcio);

  return `
  <div class="grid-2">
    <div class="card vb-card ${exp.vistoBuenoContratacion.aprobado ? 'vb-aprobado' : ''}">
      <h3>Visto Bueno para contratar</h3>
      <p class="text-muted">Requiere las Fases 1 a 4 completas.</p>
      ${resumenFases(exp)}
      ${exp.vistoBuenoContratacion.aprobado ? `
        <div class="vb-aprobado-info">✅ Aprobado por <strong>${exp.vistoBuenoContratacion.por}</strong> el ${fmtFecha(exp.vistoBuenoContratacion.fecha.slice(0,10))}</div>
      ` : `
        <form onsubmit="aprobarContratacion(event,'${exp.id}')">
          <label>Aprobado por<input required name="por" value="${loadAdmin().nombre}"></label>
          <label>Observaciones<textarea name="observaciones" rows="2"></textarea></label>
          <button class="btn btn-primary" type="submit" ${puedeContratar ? '' : 'disabled'}>
            ${puedeContratar ? 'Dar Visto Bueno y habilitar contratación' : 'Faltan fases por completar'}
          </button>
        </form>`}
    </div>

    <div class="card vb-card ${exp.vistoBuenoPago.aprobado ? 'vb-aprobado' : ''}">
      <h3>Visto Bueno para liberar el pago</h3>
      <p class="text-muted">Requiere Visto Bueno de contratación + Fase 5 completa.</p>
      ${exp.vistoBuenoPago.aprobado ? `
        <div class="vb-aprobado-info">✅ Aprobado por <strong>${exp.vistoBuenoPago.por}</strong> el ${fmtFecha(exp.vistoBuenoPago.fecha.slice(0,10))}</div>
      ` : `
        <form onsubmit="aprobarPago(event,'${exp.id}')">
          <label>Aprobado por<input required name="por" value="${loadAdmin().nombre}"></label>
          <label>Observaciones<textarea name="observaciones" rows="2"></textarea></label>
          <button class="btn btn-primary" type="submit" ${puedePagar ? '' : 'disabled'}>
            ${puedePagar ? 'Dar Visto Bueno y liberar el pago' : 'Faltan requisitos por completar'}
          </button>
        </form>`}
    </div>
  </div>

  <div class="card">
    <h3>Resumen del expediente</h3>
    <pre class="preview-text">${resumen.replace(/</g, '&lt;')}</pre>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick='copiarAlPortapapeles(${JSON.stringify(resumen)}, this)'>Copiar resumen</button>
      <button class="btn btn-secondary" onclick='abrirImprimible("Resumen de Expediente", ${JSON.stringify(resumen)})'>Ver para imprimir / PDF</button>
    </div>
  </div>

  <div class="card">
    <h3>Historial del expediente</h3>
    <ul class="historial">
      ${exp.historial.map(h => `<li><span class="text-muted">${new Date(h.fecha).toLocaleString('es-AR')}</span> — ${h.texto}</li>`).join('')}
    </ul>
  </div>
  `;
}

function resumenFases(exp) {
  const fases = [
    ['Fase 1 · Presupuesto', fase1Completa(exp)],
    ['Fase 2 · Validación fiscal', fase2Completa(exp)],
    ['Fase 3 · Instrumentación', fase3Completa(exp)],
    ['Fase 4 · Compliance laboral', fase4Completa(exp)],
  ];
  return `<ul class="lista-fases">${fases.map(([label, ok]) => `<li>${ok ? '✅' : '⬜'} ${label}</li>`).join('')}</ul>`;
}

function aprobarContratacion(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const exp = getExpediente(expId);
  if (!puedeVistoBuenoContratacion(exp)) return;
  exp.vistoBuenoContratacion = { aprobado: true, por: f.por.value, fecha: new Date().toISOString(), observaciones: f.observaciones.value };
  logExpediente(exp, `Visto Bueno de CONTRATACIÓN aprobado por ${f.por.value}.`);
  updateExpediente(exp);
  render();
}
function aprobarPago(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const exp = getExpediente(expId);
  if (!puedeVistoBuenoPago(exp)) return;
  exp.vistoBuenoPago = { aprobado: true, por: f.por.value, fecha: new Date().toISOString(), observaciones: f.observaciones.value };
  logExpediente(exp, `Visto Bueno de PAGO aprobado por ${f.por.value}.`);
  updateExpediente(exp);
  render();
}
