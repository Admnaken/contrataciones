/* ==========================================================================
   NAKEN · Contrataciones — app.js
   Lógica principal: estado (traído del servidor), router por hash y render
   de cada panel. Los datos viven en el servidor de la app principal: este
   archivo trabaja sobre una copia en memoria y guarda cada expediente por
   separado (con número de versión, para no pisar cambios hechos desde otro
   equipo).
   ========================================================================== */

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------
const S = {
  cargado: false,
  errorCarga: '',
  edificios: [],          // consorcios dados de alta en la app principal
  datosConsorcios: {},    // { [edificioId]: { cuit, direccion } } — datos propios de esta app
  parametros: null,       // parámetros de retención
  admin: null,
  expedientes: [],
  mantenimiento: {},      // { [edificioId]: [...] } historial de la app principal (se trae a demanda)
  guardando: 0,
  datosPago: {},          // { [expId]: { rubros, pagos, tienePlanillaRetenciones } } (a demanda)
  confirmarCreacion: null, // datos del alta pendiente de "crear igual" tras ver antecedentes
};
const TEXTOS = {}; // textos para los botones "Copiar" / "Imprimir" (sin meterlos en atributos HTML)

const clonar = (o) => JSON.parse(JSON.stringify(o));
const LS_VIEJO = { consorcios: 'naken_contrataciones_consorcios', expedientes: 'naken_contrataciones_expedientes', importado: 'naken_contrataciones_importado' };

function consorciosLista() {
  return S.edificios
    .filter(e => e.estado !== 'pendiente')
    .map(e => Object.assign({ id: e.id, nombre: e.nombre, spreadsheetId: e.spreadsheetId }, S.datosConsorcios[e.id] || {}));
}
function getConsorcio(id) { return consorciosLista().find(c => c.id === id) || null; }
function getExpediente(id) { const e = S.expedientes.find(x => x.id === id); return e ? clonar(e) : null; }
function loadAdmin() {
  return Object.assign({ nombre: 'Lic. Sebastián Rubén Espeche', matricula: '20.066', email: '', telefono: '' }, S.admin || {});
}
function parametros() {
  const p = clonar(PARAMETROS_RETENCION_DEFAULT);
  const g = S.parametros || {};
  ['ganancias', 'suss', 'iibb', 'iva'].forEach(k => Object.assign(p[k], g[k] || {}));
  p.actualizado = g.actualizado || '';
  return p;
}
function logExpediente(exp, texto) {
  exp.historial = exp.historial || [];
  exp.historial.unshift({ fecha: new Date().toISOString(), texto });
}
function num(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  let t = String(v == null ? '' : v).trim().replace(/[$\s]/g, '');
  if (!t) return 0;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else t = t.replace(/,/g, '');                                      // 1234.56 / 1,234.56
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const normCuit = (c) => String(c || '').replace(/\D/g, '');
// "00003-00001234", "3-1234" y "0003 00001234" son la misma factura: punto de venta + número.
function normFactura(n) {
  const partes = String(n || '').match(/[0-9]+/g) || [];
  if (partes.length >= 2) return parseInt(partes[partes.length - 2], 10) + '-' + parseInt(partes[partes.length - 1], 10);
  return partes.length ? String(parseInt(partes[0], 10)) : '';
}
function cuitValido(c) {
  const d = normCuit(c);
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let s = 0; for (let i = 0; i < 10; i++) s += (+d[i]) * pesos[i];
  let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) v = 9;
  return v === +d[10];
}

// ---------------------------------------------------------------------------
// Guardado
// ---------------------------------------------------------------------------
function indicadorGuardado() {
  const el = document.getElementById('estado-guardado');
  if (el) el.textContent = S.guardando > 0 ? 'Guardando…' : '';
}

// Guarda UN expediente en el servidor. Devuelve true si quedó guardado.
async function guardarExp(exp, opciones) {
  const op = opciones || {};
  recalcularEstado(exp);
  const previo = S.expedientes.find(x => x.id === exp.id);
  const versionBase = previo ? (previo.version || 0) : 0;
  S.guardando++; indicadorGuardado();
  try {
    // Si hay tildes de este mismo expediente guardándose, espera a que terminen.
    if (!op.enCola && colaExp[exp.id]) await colaExp[exp.id].catch(() => {});
    const d = await Api.guardarExpediente(exp, versionBase);
    if (d.ok) {
      const i = S.expedientes.findIndex(x => x.id === d.expediente.id);
      if (i >= 0) S.expedientes[i] = d.expediente; else S.expedientes.push(d.expediente);
      (d.avisos || []).forEach(a => alert(a));
      return true;
    }
    if (d.expediente) { // conflicto o expediente bloqueado: se muestra lo que hay en el servidor
      const i = S.expedientes.findIndex(x => x.id === d.expediente.id);
      if (i >= 0) S.expedientes[i] = d.expediente;
    }
    alert(d.error || 'No se pudo guardar.');
    return false;
  } catch (err) {
    alert('No se pudo guardar: ' + (err && err.message ? err.message : err) + '\nNo se perdió nada de lo que ya estaba guardado; el último cambio no se aplicó.');
    return false;
  } finally {
    S.guardando--; indicadorGuardado();
    if (!op.sinRender) render();
  }
}

// Tildes seguidos del mismo expediente (requisitos, cláusulas, documentos): se guardan
// de a uno y cada cambio se aplica sobre la última versión guardada. Así marcar varios
// casilleros rápido no se toma como un cambio "desde otro equipo" ni se pierde ninguno.
const colaExp = {};
const pendientesExp = {};
function encolarCambioExp(expId, aplicar) {
  pendientesExp[expId] = (pendientesExp[expId] || 0) + 1;
  const anterior = colaExp[expId] || Promise.resolve();
  const tarea = anterior.catch(() => {}).then(async () => {
    const quedan = --pendientesExp[expId];
    const exp = getExpediente(expId);
    if (!exp || aplicar(exp) === false) { if (!quedan) render(); return false; }
    return guardarExp(exp, { enCola: true, sinRender: quedan > 0 });
  });
  colaExp[expId] = tarea;
  tarea.finally(() => { if (colaExp[expId] === tarea) delete colaExp[expId]; });
  return tarea;
}

// Evita doble clic: el botón queda en "Guardando…" hasta que termina.
async function conBoton(btn, fn) {
  if (btn && btn.disabled) return;
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try { await fn(); } finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = original; } }
}

// ---------------------------------------------------------------------------
// Progreso / completitud por fase
// ---------------------------------------------------------------------------
function presupuestoSeleccionado(exp) {
  return (exp.presupuestos || []).find(p => p.id === exp.proveedorSeleccionadoId) || null;
}
function estaAnulado(exp) { return !!(exp.anulado && exp.anulado.fecha); }
function pagoRegistrado(exp) { return !!(exp.pagoRealizado && exp.pagoRealizado.fecha); }
function tienePlanillaRetenciones(exp) { const e = S.edificios.find(x => x.id === exp.consorcioId); return !!(e && e.tieneRetenciones); }

function fase1Completa(exp) {
  const p = presupuestoSeleccionado(exp);
  if (!p) return false;
  return REQUISITOS_PRESUPUESTO.every(r => !!p.requisitos[r.id]);
}
function fase2Completa(exp) {
  const v = exp.validacionFiscal || {};
  if (!v.cuitActivo || !v.apocOk || !v.impuestosOk) return false;
  if (!v.categoria || v.categoria === 'No determinado') return false;
  if (v.matriculaAplica && !v.matriculaOk) return false;
  return true;
}
function fase3Completa(exp) {
  const i = exp.instrumentacion || {};
  if (!i.tipo) return false;
  if (i.tipo === TIPO_INSTRUMENTACION.CONTRATO) return CLAUSULAS_CONTRATO.every(c => !!(i.clausulas || {})[c.id]);
  return true;
}
function fase4Completa(exp) {
  const c = exp.complianceLaboral || {};
  if (!c.tipoPrestador) return false;
  const lista = c.tipoPrestador === TIPO_PRESTADOR.MONOTRIBUTISTA ? DOC_LABORAL_MONOTRIBUTISTA : DOC_LABORAL_EMPRESA;
  return lista.every(d => !!(c.documentos || {})[d.id]);
}
// Problemas que impiden aprobar el pago (lista vacía = Fase 5 completa).
function problemasPago(exp) {
  const p = exp.pago || {};
  const out = [];
  if (!p.caeValidado) out.push('Falta validar el CAE de la factura en ARCA.');
  if (!p.numeroFactura) out.push('Falta el número de factura.');
  if (!p.fechaFactura) out.push('Falta la fecha de la factura.');
  if (!(num(p.totalFactura) > 0)) out.push('Falta el importe total de la factura.');
  if (Math.abs(r2(num(p.montoNeto) + num(p.montoIva)) - r2(num(p.totalFactura))) > 1) out.push('Neto + IVA no coincide con el total de la factura.');
  const esperado = tipoFacturaEsperado(exp);
  if (esperado && p.tipoFactura && p.tipoFactura !== esperado) out.push(`El proveedor es ${(exp.validacionFiscal || {}).categoria}: la factura tiene que ser ${esperado}, no ${p.tipoFactura}.`);
  if (p.tipoFactura === 'C' && num(p.montoIva) > 0) out.push('Una factura C no discrimina IVA.');
  if (!p.medioPago || !MEDIOS_PAGO_VALIDOS.includes(p.medioPago)) out.push('Falta un medio de pago válido (nunca efectivo).');
  if (!p.fechaPago) out.push('Falta la fecha de pago.');
  if (tienePlanillaRetenciones(exp)) {
    if (!p.retencionPlanilla) out.push('Falta vincular el pago con su fila de la planilla de Retenciones del consorcio.');
    else if (Math.abs(num(p.retencionPlanilla.importeTotal) - num(p.totalFactura)) > 1) out.push(`El total de la factura (${fmtMoneda(p.totalFactura)}) no coincide con el pago de la planilla de Retenciones (${fmtMoneda(p.retencionPlanilla.importeTotal)}).`);
  }
  const dup = facturaDuplicada(exp);
  if (dup) out.push(`La factura ${p.numeroFactura} de este proveedor ya está en otro expediente (${dup.tipoServicio || dup.id}).`);
  return out;
}
function fase5Completa(exp) { return problemasPago(exp).length === 0; }

function puedeVistoBuenoContratacion(exp) {
  return !estaAnulado(exp) && fase1Completa(exp) && fase2Completa(exp) && fase3Completa(exp) && fase4Completa(exp);
}
function puedeVistoBuenoPago(exp) {
  return !estaAnulado(exp) && exp.vistoBuenoContratacion.aprobado && fase5Completa(exp);
}

function recalcularEstado(exp) {
  if (estaAnulado(exp)) { exp.estado = ESTADO_EXPEDIENTE.ANULADO; return; }
  if (exp.vistoBuenoPago.aprobado) { exp.estado = pagoRegistrado(exp) ? ESTADO_EXPEDIENTE.PAGADO : ESTADO_EXPEDIENTE.PAGO_APROBADO; return; }
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
// Controles contra pagar dos veces / trabajos repetidos / garantías
// ---------------------------------------------------------------------------
function cuitDe(exp) { const p = presupuestoSeleccionado(exp); return p ? normCuit(p.proveedorCuit) : ''; }

function facturaDuplicada(exp) {
  const f = normFactura((exp.pago || {}).numeroFactura);
  const c = cuitDe(exp);
  if (!f || !c) return null;
  return S.expedientes.find(e => e.id !== exp.id && !estaAnulado(e) && cuitDe(e) === c && normFactura((e.pago || {}).numeroFactura) === f) || null;
}

// Mismo proveedor y mismo importe en los últimos 90 días (posible doble pago con otro N° de factura).
function pagosParecidos(exp) {
  const c = cuitDe(exp);
  const total = r2(num((exp.pago || {}).totalFactura));
  if (!c || !total) return [];
  const limite = Date.now() - 90 * 86400000;
  return S.expedientes.filter(e => {
    if (e.id === exp.id || estaAnulado(e) || cuitDe(e) !== c) return false;
    const p = e.pago || {};
    const fecha = new Date(p.fechaPago || p.fechaFactura || e.actualizado).getTime();
    return Math.abs(r2(num(p.totalFactura)) - total) <= 1 && fecha >= limite;
  });
}

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'con', 'para', 'por', 'un', 'una', 'al', 'sala', 'piso']);
function palabras(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w));
}
function seParecen(a, b) {
  const pa = palabras(a), pb = new Set(palabras(b));
  return pa.some(w => pb.has(w) || [...pb].some(x => (x.length >= 5 && w.length >= 5) && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))));
}
function finGarantia(e) {
  const p = presupuestoSeleccionado(e);
  const meses = p ? Number(p.garantiaMeses) || 0 : 0;
  if (!meses || !e.vistoBuenoPago.aprobado) return null;
  const base = new Date((e.pagoRealizado && e.pagoRealizado.fecha) || (e.pago && e.pago.fechaPago) || e.vistoBuenoPago.fecha);
  if (isNaN(base)) return null;
  base.setMonth(base.getMonth() + meses);
  return base;
}

// Antecedentes de un trabajo: expedientes abiertos parecidos, trabajos con garantía vigente
// y trabajos del historial de mantenimiento de la app principal en los últimos 12 meses.
function antecedentes(consorcioId, area, servicio, excluirId) {
  const texto = `${area} ${servicio}`;
  const out = { abiertos: [], enGarantia: [], mantenimiento: [] };
  S.expedientes.forEach(e => {
    if (e.id === excluirId || e.consorcioId !== consorcioId || estaAnulado(e)) return;
    if (!seParecen(texto, `${e.areaInstalacion} ${e.tipoServicio}`)) return;
    if (!e.vistoBuenoPago.aprobado) { out.abiertos.push(e); return; }
    const fin = finGarantia(e);
    if (fin && fin > new Date()) out.enGarantia.push({ e, fin });
  });
  const hace12 = Date.now() - 365 * 86400000;
  (S.mantenimiento[consorcioId] || []).forEach(t => {
    const f = parseFechaTexto(t.fecha);
    if (f && f.getTime() < hace12) return;
    if (seParecen(texto, `${t.ubicacionEquipo} ${t.descripcion}`)) out.mantenimiento.push(t);
  });
  return out;
}
function parseFechaTexto(v) {
  const t = String(v || '').trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function hayAntecedentes(a) { return a.abiertos.length + a.enGarantia.length + a.mantenimiento.length > 0; }
function htmlAntecedentes(a) {
  if (!hayAntecedentes(a)) return '';
  const items = [];
  a.enGarantia.forEach(({ e, fin }) => {
    const p = presupuestoSeleccionado(e) || {};
    items.push(`<div class="alerta alerta-red"><span>🛡️</span><div><strong>Trabajo en garantía hasta el ${esc(fin.toLocaleDateString('es-AR'))}</strong>
      <p>${esc(e.tipoServicio)} — ${esc(e.areaInstalacion)}, hecho por ${esc(p.proveedorNombre)} (${esc(p.garantiaMeses)} meses de garantía). Si es la misma falla, corresponde reclamarle la garantía antes de contratar de nuevo. <a href="#/expediente/${esc(e.id)}">Ver expediente</a></p></div></div>`);
  });
  a.abiertos.forEach(e => {
    items.push(`<div class="alerta alerta-amber"><span>📂</span><div><strong>Ya hay un expediente abierto parecido</strong>
      <p>${esc(e.tipoServicio)} — ${esc(e.areaInstalacion)} (${esc((ESTADO_META[e.estado] || {}).label || e.estado)}). Revisá que no sea el mismo trabajo. <a href="#/expediente/${esc(e.id)}">Ver expediente</a></p></div></div>`);
  });
  a.mantenimiento.forEach(t => {
    items.push(`<div class="alerta alerta-amber"><span>🔧</span><div><strong>Historial de mantenimiento: ${esc(t.ubicacionEquipo)} — ${esc(t.fecha)}</strong>
      <p>${esc(t.tipo || '')} por ${esc(t.proveedor || '')}${t.costo ? ' — ' + esc(fmtMoneda(t.costo)) : ''}. ${esc(t.descripcion || '')}</p></div></div>`);
  });
  return `<div class="alertas-panel"><h3>Antecedentes de este trabajo</h3>${items.join('')}</div>`;
}
async function asegurarMantenimiento(consorcioId) {
  if (!consorcioId || S.mantenimiento[consorcioId]) return;
  try { S.mantenimiento[consorcioId] = await Api.mantenimiento(consorcioId); }
  catch (e) { S.mantenimiento[consorcioId] = []; console.warn('No se pudo leer el historial de mantenimiento:', e); }
}

// ---------------------------------------------------------------------------
// Retenciones
// ---------------------------------------------------------------------------
function tipoFacturaEsperado(exp) {
  const cat = (exp.validacionFiscal || {}).categoria;
  if (cat === CATEGORIA_RI) return 'B';
  if (cat === CATEGORIA_MONO) return 'C';
  return '';
}
function mesDe(iso) { return String(iso || '').slice(0, 7); }

// Cálculo sugerido según los parámetros cargados. Ganancias (RG 830) se calcula sobre lo
// pagado al mismo proveedor en el mes, descontando lo ya retenido en ese mes.
function calcularRetenciones(exp, flags) {
  const par = parametros();
  const p = exp.pago || {};
  const neto = num(p.montoNeto);
  const cat = (exp.validacionFiscal || {}).categoria;
  const detalle = [];
  const r = { ganancias: 0, suss: 0, iibb: 0, iva: 0 };

  if (cat === CATEGORIA_MONO) {
    detalle.push('Ganancias: no se retiene a monotributistas.');
  } else if (!par.actualizado) {
    detalle.push('Ganancias: faltan los parámetros de retención (menú Retenciones). Cargá el importe a mano.');
  } else {
    const mes = mesDe(p.fechaPago || p.fechaFactura);
    const c = cuitDe(exp);
    const otros = S.expedientes.filter(e => e.id !== exp.id && !estaAnulado(e) && cuitDe(e) === c && e.vistoBuenoPago.aprobado && mesDe((e.pago || {}).fechaPago || (e.pago || {}).fechaFactura) === mes);
    const netoOtros = otros.reduce((s, e) => s + num((e.pago || {}).montoNeto), 0);
    const retOtros = otros.reduce((s, e) => s + num(((e.pago || {}).retenciones || {}).ganancias), 0);
    if (cat === CATEGORIA_RI) {
      const base = neto + netoOtros - num(par.ganancias.minimoNoSujeto);
      let ret = base > 0 ? base * num(par.ganancias.alicuotaInscripto) / 100 - retOtros : 0;
      if (ret < num(par.ganancias.retencionMinima)) ret = 0;
      r.ganancias = r2(Math.max(0, ret));
      detalle.push(`Ganancias (RG 830, inscripto ${par.ganancias.alicuotaInscripto}%): pagado en ${mes || 'el mes'} ${fmtMoneda(neto + netoOtros)}${otros.length ? ` (incluye ${otros.length} pago(s) anterior(es))` : ''} − mínimo no sujeto ${fmtMoneda(par.ganancias.minimoNoSujeto)}${retOtros ? ` − ya retenido ${fmtMoneda(retOtros)}` : ''} → ${fmtMoneda(r.ganancias)}.`);
    } else {
      r.ganancias = r2(neto * num(par.ganancias.alicuotaNoInscripto) / 100);
      detalle.push(`Ganancias: proveedor sin categoría confirmada, se aplica la alícuota de no inscripto (${par.ganancias.alicuotaNoInscripto}%) → ${fmtMoneda(r.ganancias)}.`);
    }
  }
  if (flags.suss) {
    if (num(par.suss.alicuota) > 0) {
      r.suss = neto >= num(par.suss.minimo) ? r2(neto * num(par.suss.alicuota) / 100) : 0;
      detalle.push(`SUSS (${par.suss.alicuota}% sobre el neto${num(par.suss.minimo) ? ', mínimo ' + fmtMoneda(par.suss.minimo) : ''}) → ${fmtMoneda(r.suss)}.`);
    } else detalle.push('SUSS: falta la alícuota en Retenciones. Cargá el importe a mano.');
  }
  if (flags.iibb) {
    const ali = num((exp.validacionFiscal || {}).agipAlicuota) || num(par.iibb.alicuotaPorDefecto);
    r.iibb = r2(neto * ali / 100);
    detalle.push(ali ? `IIBB (${ali}% del padrón AGIP sobre el neto) → ${fmtMoneda(r.iibb)}.` : 'IIBB: falta la alícuota del padrón (Fase 2). Cargá el importe a mano.');
  }
  if (flags.iva) {
    if (num(par.iva.alicuota) > 0 && p.tipoFactura === 'B') {
      r.iva = r2(num(p.montoIva) * num(par.iva.alicuota) / 100);
      detalle.push(`IVA (${par.iva.alicuota}% del IVA facturado) → ${fmtMoneda(r.iva)}.`);
    } else detalle.push('IVA: solo aplica sobre factura B y con la alícuota cargada en Retenciones.');
  }
  return { r, detalle };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function initApp() {
  if (!window.location.hash) window.location.hash = '#/dashboard';
  if (!window.__routerListo) { window.addEventListener('hashchange', render); window.__routerListo = true; }
  document.getElementById('main-content').innerHTML = `<div class="empty-state"><h2>Cargando expedientes…</h2><p>Trayendo los datos del servidor.</p></div>`;
  try {
    const d = await Api.cargar();
    S.edificios = d.edificios || [];
    S.datosConsorcios = d.datosConsorcios || {};
    S.parametros = d.parametros || null;
    S.admin = d.admin || null;
    S.expedientes = d.expedientes || [];
    S.cargado = true; S.errorCarga = '';
  } catch (e) {
    S.errorCarga = e && e.message ? e.message : String(e);
  }
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
  if (!S.cargado) {
    main.innerHTML = S.errorCarga
      ? `<div class="empty-state"><h2>No se pudieron cargar los datos</h2><p>${esc(S.errorCarga)}</p><button class="btn btn-primary" onclick="initApp()">Reintentar</button></div>`
      : `<div class="empty-state"><h2>Cargando…</h2></div>`;
    return;
  }
  try {
    if (ruta === 'dashboard' || !ruta) main.innerHTML = viewDashboard();
    else if (ruta === 'consorcios') main.innerHTML = viewConsorcios();
    else if (ruta === 'admin') main.innerHTML = viewAdmin();
    else if (ruta === 'retenciones') main.innerHTML = viewRetenciones();
    else if (ruta === 'expediente' && param === 'nuevo') main.innerHTML = viewExpedienteNuevo();
    else if (ruta === 'expediente' && param) main.innerHTML = viewExpedienteDetalle(param);
    else main.innerHTML = viewDashboard();
    main.querySelectorAll('.nk-bloqueado').forEach(z => {
      z.querySelectorAll('input, select, textarea, button:not(.nk-libre)').forEach(el => { el.disabled = true; });
    });
  } catch (e) {
    main.innerHTML = `<div class="empty-state"><h2>Ocurrió un error al mostrar esta pantalla</h2><p>${esc(e.message)}</p></div>`;
    console.error(e);
  }
}

function ir(ruta) { window.location.hash = '#/' + ruta; }

// Botones de copiar / imprimir: el texto queda en TEXTOS, el botón solo lleva la clave.
function botonCopiar(clave, texto, etiqueta) {
  TEXTOS[clave] = texto;
  return `<button class="btn btn-secondary nk-libre" type="button" onclick="copiarAlPortapapeles(TEXTOS['${clave}'], this)">${esc(etiqueta || 'Copiar')}</button>`;
}
function botonImprimir(clave, titulo, texto) {
  TEXTOS[clave] = texto;
  TEXTOS[clave + '_t'] = titulo;
  return `<button class="btn btn-secondary nk-libre" type="button" onclick="abrirImprimible(TEXTOS['${clave}_t'], TEXTOS['${clave}'])">Ver para imprimir / PDF</button>`;
}

// ---------------------------------------------------------------------------
// Badge de estado
// ---------------------------------------------------------------------------
function badgeEstado(estado) {
  const meta = ESTADO_META[estado] || { label: estado, color: 'slate' };
  return `<span class="badge badge-${meta.color}">${esc(meta.label)}</span>`;
}
function barraProgreso(pct) {
  return `<div class="progress-track"><div class="progress-fill" style="width:${Number(pct) || 0}%"></div></div>`;
}

// ---------------------------------------------------------------------------
// VIEW: Dashboard
// ---------------------------------------------------------------------------
function bannerImportacion() {
  let viejos = [];
  try { viejos = JSON.parse(localStorage.getItem(LS_VIEJO.expedientes) || '[]'); } catch (e) {}
  let importado = false;
  try { importado = localStorage.getItem(LS_VIEJO.importado) === '1'; } catch (e) {}
  if (!viejos.length || importado) return '';
  return `<div class="alertas-panel"><div class="alerta alerta-gold"><span>📦</span><div>
    <strong>Hay ${viejos.length} expediente(s) de la versión anterior guardados solo en este navegador</strong>
    <p>Pasalos al servidor para no perderlos y verlos desde cualquier equipo. Los archivos adjuntos se suben a tu Drive.</p>
    <button class="btn btn-primary btn-sm" onclick="importarDatosViejos(this)">Importar al servidor</button></div></div></div>`;
}

function viewDashboard() {
  const expedientes = S.expedientes.map(clonar);
  const consorcios = consorciosLista();
  expedientes.forEach(recalcularEstado);

  if (!consorcios.length) {
    return `
    <div class="page-header"><h1>Panel de contrataciones</h1><p>Circuito de contratación de servicios de mantenimiento — Protocolo Ley 941 / Disp. 856/14.</p></div>
    <div class="empty-state">
      <div class="empty-icon">🏢</div>
      <h2>No hay consorcios dados de alta</h2>
      <p>Los consorcios se dan de alta en la app principal de administración; acá aparecen solos.</p>
    </div>`;
  }

  const alertas = generarAlertas(expedientes);
  const terminados = (e) => [ESTADO_EXPEDIENTE.PAGADO, ESTADO_EXPEDIENTE.CERRADO, ESTADO_EXPEDIENTE.RECHAZADO, ESTADO_EXPEDIENTE.ANULADO].includes(e.estado);
  const activos = expedientes.filter(e => !terminados(e));
  const cerrados = expedientes.filter(terminados).sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));

  const kpis = [
    { label: 'Expedientes activos', valor: activos.length },
    { label: 'Esperando VB de contratación', valor: expedientes.filter(e => e.estado === ESTADO_EXPEDIENTE.LISTO_PARA_CONTRATAR).length },
    { label: 'Esperando VB de pago', valor: expedientes.filter(e => e.estado === ESTADO_EXPEDIENTE.LISTO_PARA_PAGAR).length },
    { label: 'Pagados / anulados', valor: cerrados.length },
  ];

  return `
  <div class="page-header">
    <h1>Panel de contrataciones</h1>
    <p>Circuito de contratación de servicios de mantenimiento — Protocolo Ley 941 / Disp. 856/14.</p>
    <button class="btn btn-primary" onclick="ir('expediente/nuevo')">+ Nuevo expediente</button>
  </div>
  ${bannerImportacion()}
  <div class="kpi-row">
    ${kpis.map(k => `<div class="kpi-card"><div class="kpi-valor">${k.valor}</div><div class="kpi-label">${esc(k.label)}</div></div>`).join('')}
  </div>

  ${alertas.length ? `<div class="alertas-panel">
    <h3>Alertas y vencimientos</h3>
    ${alertas.map(a => `<div class="alerta alerta-${a.nivel}"><span>${a.icono}</span><div><strong>${esc(a.titulo)}</strong><p>${esc(a.texto)}</p></div></div>`).join('')}
  </div>` : ''}

  <h3 class="section-title">Expedientes activos</h3>
  ${activos.length ? `<div class="tabla-expedientes">${activos.map(e => filaExpediente(e, consorcios)).join('')}</div>`
    : `<div class="empty-state-mini">No hay expedientes activos. <a href="#/expediente/nuevo">Crear el primero</a>.</div>`}

  ${cerrados.length ? `<h3 class="section-title">Historial</h3><div class="tabla-expedientes">${cerrados.map(e => filaExpediente(e, consorcios)).join('')}</div>` : ''}
  `;
}

function generarAlertas(expedientes) {
  const alertas = [];
  if (!parametros().actualizado) {
    alertas.push({ nivel: 'amber', icono: '🧾', titulo: 'Faltan los parámetros de retención',
      texto: 'Cargá en "Retenciones" el mínimo no sujeto de Ganancias y las alícuotas que te indique el contador, para que la app calcule las retenciones de cada pago.' });
  }
  expedientes.forEach(e => {
    if ([ESTADO_EXPEDIENTE.PAGADO, ESTADO_EXPEDIENTE.CERRADO, ESTADO_EXPEDIENTE.ANULADO].includes(e.estado)) return;
    if (e.estado === ESTADO_EXPEDIENTE.PAGO_APROBADO) { /* alerta propia más abajo */ }
    const p = presupuestoSeleccionado(e);
    if (p) {
      const dias = diasHabilesDesde(String(p.recibido).slice(0, 10));
      if (dias !== null && dias >= 15 && !e.vistoBuenoContratacion.aprobado) {
        alertas.push({ nivel: 'amber', icono: '⏱️', titulo: `Oferta posiblemente vencida — ${e.tipoServicio || 'expediente'}`,
          texto: `Pasaron ${dias} días hábiles desde la recepción del presupuesto. Revisar vigencia antes de contratar.` });
      }
    }
    if (e.estado === ESTADO_EXPEDIENTE.LISTO_PARA_CONTRATAR) {
      alertas.push({ nivel: 'blue', icono: '✅', titulo: 'Listo para Visto Bueno de contratación',
        texto: `El expediente "${e.tipoServicio || 'sin nombre'}" completó las fases 1 a 4 y está esperando la aprobación para contratar.` });
    }
    if (e.estado === ESTADO_EXPEDIENTE.PAGO_APROBADO) {
      alertas.push({ nivel: 'gold', icono: '🏦', titulo: 'Pago aprobado: falta registrar que se hizo',
        texto: `"${e.tipoServicio || 'sin nombre'}": cuando hagas la transferencia, registrala en "Vistos buenos" para que se cargue el gasto en la liquidación.` });
    }
    if (e.estado === ESTADO_EXPEDIENTE.LISTO_PARA_PAGAR) {
      alertas.push({ nivel: 'gold', icono: '💳', titulo: 'Listo para Visto Bueno de pago',
        texto: `El expediente "${e.tipoServicio || 'sin nombre'}" completó la Fase 5 y está esperando la liberación de pago.` });
    }
    if (e.complianceLaboral && e.complianceLaboral.tipoPrestador === TIPO_PRESTADOR.EMPRESA && !fase4Completa(e) && e.presupuestos.length) {
      alertas.push({ nivel: 'red', icono: '⚠️', titulo: 'Riesgo Art. 30 LCT — documentación laboral incompleta',
        texto: `Falta documentación laboral/previsional del contratista en "${e.tipoServicio || 'expediente'}". No debe iniciarse la tarea sin ella.` });
    }
  });
  return alertas;
}

function filaExpediente(e, consorcios) {
  const cons = consorcios.find(c => c.id === e.consorcioId);
  const p = presupuestoSeleccionado(e);
  const monto = (e.pago && num(e.pago.totalFactura)) || (p ? p.monto : 0);
  return `
  <a class="fila-exp" href="#/expediente/${esc(e.id)}">
    <div class="fila-exp-main">
      <strong>${esc(e.tipoServicio || 'Servicio sin nombre')}</strong>
      <span class="fila-exp-sub">${esc(cons ? cons.nombre : 'Consorcio no encontrado')} · ${esc(e.areaInstalacion || '-')}${p ? ' · ' + esc(p.proveedorNombre) : ''}</span>
    </div>
    <div class="fila-exp-monto">${monto ? fmtMoneda(monto) : '—'}</div>
    <div class="fila-exp-progreso">${barraProgreso(progresoPct(e))}</div>
    <div class="fila-exp-estado">${badgeEstado(e.estado)}</div>
  </a>`;
}

// ---------------------------------------------------------------------------
// VIEW: Consorcios (vienen de la app principal; acá se completan CUIT y dirección)
// ---------------------------------------------------------------------------
function viewConsorcios() {
  const consorcios = consorciosLista();
  return `
  <div class="page-header"><h1>Consorcios</h1><p>Son los mismos consorcios de la app principal. Completá el CUIT y la dirección: se usan en los emails, contratos y actas.</p></div>
  <div class="card">
    ${consorcios.length ? `<ul class="lista-simple">${consorcios.map(c => `
      <li>
        <div style="flex:1;">
          <strong>${esc(c.nombre)}</strong>${c.spreadsheetId ? '' : ' <span class="badge badge-amber">sin planilla vinculada</span>'}
          <form onsubmit="guardarDatosConsorcio(event, '${esc(c.id)}')" class="form-inline-nk">
            <label>Dirección completa<input name="direccion" required value="${esc(c.direccion || '')}" placeholder="Talcahuano 1234, CABA"></label>
            <label>CUIT del consorcio<input name="cuit" required value="${esc(c.cuit || '')}" placeholder="30-XXXXXXXX-X"></label>
            <button class="btn btn-ghost btn-sm" type="submit">Guardar</button>
          </form>
        </div>
      </li>`).join('')}</ul>` : `<p class="text-muted">No hay consorcios dados de alta en la app principal.</p>`}
  </div>`;
}

async function guardarDatosConsorcio(ev, id) {
  ev.preventDefault();
  const f = ev.target;
  const cuit = f.cuit.value.trim();
  if (!cuitValido(cuit)) { alert('El CUIT no es válido (revisá los 11 dígitos).'); return; }
  const datos = clonar(S.datosConsorcios);
  datos[id] = { cuit, direccion: f.direccion.value.trim() };
  await conBoton(f.querySelector('button'), async () => {
    try { await Api.guardarConfig('consorcios', datos); S.datosConsorcios = datos; render(); }
    catch (e) { alert(e.message); }
  });
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
      <label>Nombre completo<input required name="nombre" value="${esc(a.nombre)}"></label>
      <label>Matrícula RPA CABA<input required name="matricula" value="${esc(a.matricula)}"></label>
      <label>Email<input type="email" name="email" value="${esc(a.email || '')}"></label>
      <label>Teléfono<input name="telefono" value="${esc(a.telefono || '')}"></label>
      <button class="btn btn-primary" type="submit">Guardar</button>
    </form>
  </div>`;
}
async function guardarAdmin(ev) {
  ev.preventDefault();
  const f = ev.target;
  const valor = { nombre: f.nombre.value.trim(), matricula: f.matricula.value.trim(), email: f.email.value.trim(), telefono: f.telefono.value.trim() };
  await conBoton(f.querySelector('button'), async () => {
    try { await Api.guardarConfig('admin', valor); S.admin = valor; alert('Datos guardados.'); render(); }
    catch (e) { alert(e.message); }
  });
}

// ---------------------------------------------------------------------------
// VIEW: Parámetros de retención
// ---------------------------------------------------------------------------
function viewRetenciones() {
  const p = parametros();
  return `
  <div class="page-header"><h1>Parámetros de retención</h1>
    <p>La app calcula las retenciones de cada pago con estos valores. Los importes mínimos y algunas alícuotas cambian con la normativa: confirmalos con el contador y actualizalos cuando cambien.${p.actualizado ? ' Última actualización: ' + esc(fmtFechaCorta(p.actualizado.slice(0, 10))) + '.' : ''}</p></div>
  <div class="card card-narrow">
    <form onsubmit="guardarParametros(event)">
      <h3>Ganancias — RG 830 (locaciones de obra y servicios)</h3>
      <label>Alícuota para inscriptos (%)<input name="g_ins" type="number" step="0.01" min="0" value="${esc(p.ganancias.alicuotaInscripto)}"></label>
      <label>Alícuota para no inscriptos (%)<input name="g_noins" type="number" step="0.01" min="0" value="${esc(p.ganancias.alicuotaNoInscripto)}"></label>
      <label>Mínimo no sujeto a retención por mes y proveedor ($)<input name="g_min" type="number" step="0.01" min="0" required value="${esc(p.ganancias.minimoNoSujeto || '')}"></label>
      <label>Retención mínima — por debajo no se retiene ($)<input name="g_retmin" type="number" step="0.01" min="0" value="${esc(p.ganancias.retencionMinima || '')}"></label>
      <h3>SUSS</h3>
      <label>Alícuota (%)<input name="s_ali" type="number" step="0.01" min="0" value="${esc(p.suss.alicuota || '')}"></label>
      <label>Importe mínimo del pago para retener ($)<input name="s_min" type="number" step="0.01" min="0" value="${esc(p.suss.minimo || '')}"></label>
      <h3>Ingresos Brutos (AGIP)</h3>
      <label>Alícuota por defecto si el padrón no indica otra (%)<input name="i_ali" type="number" step="0.01" min="0" value="${esc(p.iibb.alicuotaPorDefecto || '')}"></label>
      <h3>IVA</h3>
      <label>Alícuota de retención sobre el IVA facturado (%) — solo si el consorcio es agente de retención<input name="v_ali" type="number" step="0.01" min="0" value="${esc(p.iva.alicuota || '')}"></label>
      <button class="btn btn-primary" type="submit">Guardar parámetros</button>
    </form>
  </div>`;
}
async function guardarParametros(ev) {
  ev.preventDefault();
  const f = ev.target;
  const valor = {
    actualizado: new Date().toISOString(),
    ganancias: { alicuotaInscripto: num(f.g_ins.value), alicuotaNoInscripto: num(f.g_noins.value), minimoNoSujeto: num(f.g_min.value), retencionMinima: num(f.g_retmin.value) },
    suss: { alicuota: num(f.s_ali.value), minimo: num(f.s_min.value) },
    iibb: { alicuotaPorDefecto: num(f.i_ali.value) },
    iva: { alicuota: num(f.v_ali.value) },
  };
  await conBoton(f.querySelector('button'), async () => {
    try { await Api.guardarConfig('parametros', valor); S.parametros = valor; alert('Parámetros guardados.'); render(); }
    catch (e) { alert(e.message); }
  });
}

// ---------------------------------------------------------------------------
// VIEW: Nuevo expediente (con revisión de antecedentes antes de crearlo)
// ---------------------------------------------------------------------------
function viewExpedienteNuevo() {
  const consorcios = consorciosLista();
  if (!consorcios.length) {
    return `<div class="empty-state"><h2>No hay consorcios</h2><p>Se dan de alta en la app principal.</p></div>`;
  }
  const d = S.confirmarCreacion || {};
  const ant = S.confirmarCreacion ? antecedentes(d.consorcioId, d.areaInstalacion, d.tipoServicio) : null;
  return `
  <div class="page-header"><h1>Nuevo expediente de contratación</h1><p>Fase 1 — Solicitud de presupuesto (Ley 941 / Disp. 856/14).</p></div>
  ${ant ? htmlAntecedentes(ant) : ''}
  <div class="card card-narrow">
    <form onsubmit="crearExpediente(event)">
      <label>Consorcio
        <select required name="consorcioId">${consorcios.map(c => `<option value="${esc(c.id)}" ${d.consorcioId === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
      </label>
      <label>Servicio / rubro<input required name="tipoServicio" value="${esc(d.tipoServicio || '')}" placeholder="ej: Mantenimiento de ascensores"></label>
      <label>Área o instalación<input required name="areaInstalacion" value="${esc(d.areaInstalacion || '')}" placeholder="ej: Ascensor palier / Fachada / Sala de bombas"></label>
      <label>Tipo de mantenimiento
        <select name="tipoMantenimiento"><option value="preventivo" ${d.tipoMantenimiento === 'preventivo' ? 'selected' : ''}>Preventivo</option><option value="correctivo" ${d.tipoMantenimiento === 'correctivo' ? 'selected' : ''}>Correctivo</option></select>
      </label>
      <label>Detalle de los trabajos requeridos<textarea name="descripcion" rows="4" placeholder="Descripción sumaria para incluir en el email de pedido de presupuesto">${esc(d.descripcion || '')}</textarea></label>
      <label>Fecha límite para recibir ofertas<input type="date" name="fechaLimiteOferta" value="${esc(d.fechaLimiteOferta || '')}" min="2000-01-01" max="2099-12-31"></label>
      <button class="btn btn-primary" type="submit">${ant && hayAntecedentes(ant) ? 'Revisé los antecedentes — crear igual' : 'Crear expediente'}</button>
    </form>
  </div>`;
}

async function crearExpediente(ev) {
  ev.preventDefault();
  const f = ev.target;
  const btn = f.querySelector('button[type="submit"]');
  const datos = {
    consorcioId: f.consorcioId.value,
    tipoServicio: f.tipoServicio.value.trim(),
    areaInstalacion: f.areaInstalacion.value.trim(),
    tipoMantenimiento: f.tipoMantenimiento.value,
    descripcion: f.descripcion.value.trim(),
    fechaLimiteOferta: f.fechaLimiteOferta.value,
  };
  if (datos.fechaLimiteOferta && !/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaLimiteOferta)) { alert('Revisá la fecha límite (el año tiene que tener 4 cifras).'); return; }
  await conBoton(btn, async () => {
    // Antes de crear: ¿hay algo parecido abierto, en garantía o en el historial de mantenimiento?
    await asegurarMantenimiento(datos.consorcioId);
    const ant = antecedentes(datos.consorcioId, datos.areaInstalacion, datos.tipoServicio);
    const yaConfirmado = S.confirmarCreacion && JSON.stringify(S.confirmarCreacion) === JSON.stringify(datos);
    if (hayAntecedentes(ant) && !yaConfirmado) {
      S.confirmarCreacion = datos;
      render();
      window.scrollTo(0, 0);
      return;
    }
    const exp = nuevoExpediente(Object.assign({}, datos, { estado: ESTADO_EXPEDIENTE.EN_PRESUPUESTOS }));
    if (hayAntecedentes(ant)) logExpediente(exp, `Se creó habiendo revisado ${ant.abiertos.length + ant.enGarantia.length + ant.mantenimiento.length} antecedente(s) parecido(s).`);
    const ok = await guardarExp(exp, { sinRender: true });
    if (ok) { S.confirmarCreacion = null; ir('expediente/' + exp.id); }
  });
}

// ---------------------------------------------------------------------------
// VIEW: Detalle de expediente (tabs F1-F5 + vistos buenos)
// ---------------------------------------------------------------------------
function bloqueoDeTab(exp, tab) {
  if (estaAnulado(exp)) return 'Expediente anulado: no se puede modificar.';
  if (['f1', 'f2', 'f3', 'f4'].includes(tab) && exp.vistoBuenoContratacion.aprobado) return 'Esta fase quedó aprobada con el Visto Bueno de contratación y no se puede modificar.';
  if (tab === 'f5' && exp.vistoBuenoPago.aprobado) return 'El pago ya fue aprobado: estos datos quedaron fijos.';
  return '';
}

function viewExpedienteDetalle(id) {
  const exp = getExpediente(id);
  if (!exp) return `<div class="empty-state"><h2>Expediente no encontrado</h2><p><a href="#/dashboard">Volver al panel</a></p></div>`;
  recalcularEstado(exp);
  const consorcio = getConsorcio(exp.consorcioId);
  const admin = loadAdmin();
  if (!S.mantenimiento[exp.consorcioId]) asegurarMantenimiento(exp.consorcioId).then(() => { if (location.hash.includes(exp.id)) render(); });

  const tab = (window.location.hash.split('?')[1] || '').replace('tab=', '') || 'f1';
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

  const bloqueo = bloqueoDeTab(exp, tab);
  return `
  <div class="page-header expediente-header">
    <div>
      <a class="volver" href="#/dashboard">← Panel</a>
      <h1>${esc(exp.tipoServicio || 'Expediente sin nombre')}</h1>
      <p>${esc(consorcio ? consorcio.nombre + (consorcio.direccion ? ' · ' + consorcio.direccion : '') : 'Consorcio no encontrado')} · N° ${esc(exp.id)}</p>
    </div>
    <div class="expediente-header-right">
      ${badgeEstado(exp.estado)}
      ${barraProgreso(progresoPct(exp))}
    </div>
  </div>
  ${estaAnulado(exp) ? `<div class="alerta alerta-red"><span>⛔</span><div><strong>Anulado el ${esc(fmtFechaCorta(exp.anulado.fecha.slice(0, 10)))}</strong><p>${esc(exp.anulado.motivo)}</p></div></div>` : ''}

  <div class="tabs">
    ${tabsDef.map(t => `<a class="tab ${tab === t.id ? 'active' : ''}" href="#/expediente/${esc(exp.id)}?tab=${t.id}">
      ${t.done ? '<span class="tab-check">✓</span>' : ''}${esc(t.label)}</a>`).join('')}
  </div>

  <div class="tab-content">
    ${bloqueo ? `<div class="alerta alerta-blue nk-bloqueo"><span>🔒</span><div><strong>${esc(bloqueo)}</strong></div></div>` : ''}
    <div class="${bloqueo ? 'nk-bloqueado' : ''}">${contenidoTab}</div>
  </div>
  `;
}

// --- Tab: Fase 1 — presupuestos --------------------------------------------
function tabPresupuestos(exp, consorcio, admin) {
  const email = generarEmailPresupuesto(exp, consorcio, admin);
  const ant = antecedentes(exp.consorcioId, exp.areaInstalacion, exp.tipoServicio, exp.id);
  return `
  ${htmlAntecedentes(ant)}
  ${!consorcio || !consorcio.cuit ? `<div class="alerta alerta-amber"><span>🏢</span><div><strong>Falta el CUIT o la dirección del consorcio</strong><p>Completalos en <a href="#/consorcios">Consorcios</a> para que salgan bien en el email y el contrato.</p></div></div>` : ''}
  <div class="grid-2">
    <div class="card">
      <h3>Email de pedido de presupuesto</h3>
      <p class="text-muted">Generado según Ley 941 y Disp. 856/14. Completá los datos del proveedor antes de enviarlo.</p>
      <pre class="preview-text">${esc(email)}</pre>
      ${botonCopiar('email_' + exp.id, email, 'Copiar email')}
    </div>
    <div class="card">
      <h3>Cargar presupuesto recibido</h3>
      <form onsubmit="agregarPresupuesto(event, '${esc(exp.id)}')">
        <label>Proveedor / Razón social<input required name="proveedorNombre"></label>
        <label>CUIT<input required name="proveedorCuit" placeholder="30-XXXXXXXX-X"></label>
        <label>Email<input type="email" name="proveedorEmail"></label>
        <label>Teléfono<input name="proveedorTelefono"></label>
        <label>Monto cotizado (ARS, IVA incluido)<input required type="number" step="0.01" min="0.01" name="monto"></label>
        <label>Garantía ofrecida (meses)<input type="number" step="1" min="0" name="garantiaMeses" placeholder="0 si no ofrece"></label>
        <label>Archivo del presupuesto (PDF o foto — se guarda en tu Drive)<input type="file" name="archivo" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"></label>
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
        <strong>${esc(p.proveedorNombre)}</strong> <span class="text-muted">CUIT ${esc(p.proveedorCuit)}</span>
        <div class="text-muted">${fmtMoneda(p.monto)} · recibido ${esc(fmtFecha(String(p.recibido).slice(0, 10)))}${Number(p.garantiaMeses) > 0 ? ' · garantía ' + esc(p.garantiaMeses) + ' meses' : ''}
        ${p.archivoUrl ? ` · <a href="${esc(p.archivoUrl)}" target="_blank" rel="noopener">Ver archivo</a>` : ''}</div>
      </div>
      <div class="presupuesto-actions">
        <span class="badge ${ok ? 'badge-green' : 'badge-amber'}">${completos}/${total} requisitos</span>
        ${esSeleccionado ? '<span class="badge badge-teal">Seleccionado</span>' :
          `<button class="btn btn-sm btn-secondary" onclick="seleccionarPresupuesto(this,'${esc(exp.id)}','${esc(p.id)}')">Seleccionar</button>`}
        <button class="btn btn-sm btn-ghost" onclick="eliminarPresupuesto(this,'${esc(exp.id)}','${esc(p.id)}')">Eliminar</button>
      </div>
    </div>
    <div class="checklist">
      ${REQUISITOS_PRESUPUESTO.map(r => `
        <label class="check-item">
          <input type="checkbox" ${p.requisitos[r.id] ? 'checked' : ''} onchange="toggleRequisitoPresupuesto(this,'${esc(exp.id)}','${esc(p.id)}','${r.id}', this.checked)">
          <div><strong>${esc(r.label)}</strong><span>${esc(r.detalle)}</span></div>
        </label>`).join('')}
    </div>
  </div>`;
}

async function agregarPresupuesto(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const btn = f.querySelector('button[type="submit"]');
  const cuit = f.proveedorCuit.value.trim();
  if (!cuitValido(cuit) && !confirm('El CUIT ' + cuit + ' no parece válido (dígito verificador). ¿Cargarlo igual?')) return;
  const monto = num(f.monto.value);
  if (!(monto > 0)) { alert('El monto cotizado tiene que ser mayor a cero.'); return; }
  await conBoton(btn, async () => {
    const exp = getExpediente(expId);
    if ((exp.presupuestos || []).some(p => normCuit(p.proveedorCuit) === normCuit(cuit) && r2(p.monto) === r2(monto)) &&
        !confirm('Ya hay un presupuesto de este proveedor por el mismo monto en este expediente. ¿Agregarlo igual?')) return;
    let archivoUrl = '', archivoNombre = '';
    const file = f.archivo.files[0];
    if (file) {
      btn.textContent = 'Subiendo archivo…';
      const cons = getConsorcio(exp.consorcioId);
      try { archivoUrl = await Api.subirArchivo(file, `Contrataciones - ${cons ? cons.nombre : 'Sin consorcio'}`); archivoNombre = file.name; }
      catch (e) { if (!confirm('No se pudo subir el archivo (' + e.message + '). ¿Cargar el presupuesto sin archivo?')) return; }
      btn.textContent = 'Guardando…';
    }
    const p = nuevoPresupuesto({
      proveedorNombre: f.proveedorNombre.value.trim(), proveedorCuit: cuit,
      proveedorEmail: f.proveedorEmail.value.trim(), proveedorTelefono: f.proveedorTelefono.value.trim(),
      monto, garantiaMeses: Math.max(0, parseInt(f.garantiaMeses.value, 10) || 0),
      archivoNombre, archivoUrl,
    });
    exp.presupuestos.push(p);
    logExpediente(exp, `Presupuesto cargado: ${p.proveedorNombre} — ${fmtMoneda(p.monto)}${p.garantiaMeses ? ` — garantía ${p.garantiaMeses} meses` : ''}.`);
    await guardarExp(exp);
  });
}

async function toggleRequisitoPresupuesto(el, expId, presId, reqId, valor) {
  el.disabled = true;
  await encolarCambioExp(expId, (exp) => {
    const p = exp.presupuestos.find(x => x.id === presId);
    if (!p) return false;
    p.requisitos[reqId] = valor;
  });
}

async function seleccionarPresupuesto(btn, expId, presId) {
  await conBoton(btn, async () => {
    const exp = getExpediente(expId);
    const p = exp.presupuestos.find(x => x.id === presId);
    exp.proveedorSeleccionadoId = presId;
    logExpediente(exp, `Proveedor seleccionado: ${p.proveedorNombre}.`);
    await guardarExp(exp);
  });
}

async function eliminarPresupuesto(btn, expId, presId) {
  if (!confirm('¿Eliminar este presupuesto? Queda registrado en el historial del expediente.')) return;
  await conBoton(btn, async () => {
    const exp = getExpediente(expId);
    const p = exp.presupuestos.find(x => x.id === presId) || {};
    exp.presupuestos = exp.presupuestos.filter(x => x.id !== presId);
    if (exp.proveedorSeleccionadoId === presId) exp.proveedorSeleccionadoId = null;
    logExpediente(exp, `Presupuesto eliminado: ${p.proveedorNombre || ''} — ${fmtMoneda(p.monto)}.`);
    await guardarExp(exp);
  });
}

// --- Tab: Fase 2 — validación fiscal ----------------------------------------
function tabValidacionFiscal(exp) {
  const v = exp.validacionFiscal || {};
  const p = presupuestoSeleccionado(exp);
  if (!p) return `<div class="empty-state-mini">Primero seleccioná un presupuesto en la Fase 1.</div>`;
  return `
  <div class="card card-narrow">
    <h3>Compliance fiscal y técnico — ${esc(p.proveedorNombre)}</h3>
    <p class="text-muted">Verificaciones ante ARCA, base APOC, AGIP y habilitación matricular AGC/SART. La categoría define el tipo de factura esperado y las retenciones.</p>
    <form onsubmit="guardarValidacionFiscal(event, '${esc(exp.id)}')">
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
      <div><strong>${esc(campo.label)}</strong>${campo.ayuda ? `<span>${esc(campo.ayuda)}</span>` : ''}</div>
    </label>`;
  }
  if (campo.tipo === 'select') {
    return `<label>${esc(campo.label)}<select name="${campo.id}">
      <option value="">Elegir…</option>
      ${campo.opciones.map(o => `<option ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    </select></label>`;
  }
  return `<label>${esc(campo.label)}<input name="${campo.id}" value="${esc(val || '')}" placeholder="${esc(campo.placeholder || '')}"></label>`;
}

async function guardarValidacionFiscal(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const v = {};
  VALIDACION_FISCAL_CAMPOS.forEach(c => { v[c.id] = c.tipo === 'bool' ? f[c.id].checked : f[c.id].value.trim(); });
  if (v.agipAlicuota && !(num(v.agipAlicuota) >= 0 && num(v.agipAlicuota) < 20)) { alert('Revisá la alícuota de IIBB: va en %, por ejemplo 2.5'); return; }
  await conBoton(f.querySelector('button[type="submit"]'), async () => {
    const exp = getExpediente(expId);
    exp.validacionFiscal = v;
    logExpediente(exp, `Validación fiscal actualizada${v.categoria ? ' (' + v.categoria + ')' : ''}.`);
    await guardarExp(exp);
  });
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
    <form onsubmit="guardarTipoInstrumentacion(event,'${esc(exp.id)}')">
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
          <input type="checkbox" ${(i.clausulas || {})[c.id] ? 'checked' : ''} onchange="toggleClausula(this,'${esc(exp.id)}','${c.id}', this.checked)">
          <div><strong>${esc(c.label)}</strong><span>${esc(c.detalle)}</span></div>
        </label>`).join('')}
    </div>
  </div>
  <div class="card">
    <h3>Contrato generado</h3>
    <pre class="preview-text">${esc(contratoTexto)}</pre>
    <div class="btn-row">
      ${botonCopiar('contrato_' + exp.id, contratoTexto, 'Copiar texto')}
      ${botonImprimir('contratoP_' + exp.id, 'Contrato de Locación', contratoTexto)}
    </div>
  </div>` : ''}
  `;
}

async function guardarTipoInstrumentacion(ev, expId) {
  ev.preventDefault();
  const tipo = ev.target.tipo.value;
  if (!tipo) { alert('Elegí el encuadre.'); return; }
  await conBoton(ev.target.querySelector('button[type="submit"]'), async () => {
    const exp = getExpediente(expId);
    exp.instrumentacion = Object.assign({ clausulas: {} }, exp.instrumentacion, { tipo });
    logExpediente(exp, `Encuadre jurídico: ${tipo === TIPO_INSTRUMENTACION.CONTRATO ? 'Contrato de locación' : 'Presupuesto aprobado'}.`);
    await guardarExp(exp);
  });
}
async function toggleClausula(el, expId, clausulaId, valor) {
  el.disabled = true;
  await encolarCambioExp(expId, (exp) => {
    exp.instrumentacion.clausulas = exp.instrumentacion.clausulas || {};
    exp.instrumentacion.clausulas[clausulaId] = valor;
  });
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
    <form onsubmit="guardarTipoPrestador(event,'${esc(exp.id)}')">
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
          <input type="checkbox" ${(c.documentos || {})[d.id] ? 'checked' : ''} onchange="toggleDocLaboral(this,'${esc(exp.id)}','${d.id}', this.checked)">
          <div><strong>${esc(d.label)}</strong>${d.detalle ? `<span>${esc(d.detalle)}</span>` : ''}</div>
        </label>`).join('')}
    </div>
  </div>` : ''}
  `;
}

async function guardarTipoPrestador(ev, expId) {
  ev.preventDefault();
  const tipo = ev.target.tipoPrestador.value;
  if (!tipo) { alert('Elegí el tipo de prestador.'); return; }
  await conBoton(ev.target.querySelector('button[type="submit"]'), async () => {
    const exp = getExpediente(expId);
    exp.complianceLaboral = Object.assign({ documentos: {} }, exp.complianceLaboral, { tipoPrestador: tipo });
    logExpediente(exp, `Tipo de prestador: ${tipo === TIPO_PRESTADOR.EMPRESA ? 'Empresa con personal' : 'Monotributista independiente'}.`);
    await guardarExp(exp);
  });
}
async function toggleDocLaboral(el, expId, docId, valor) {
  el.disabled = true;
  await encolarCambioExp(expId, (exp) => {
    exp.complianceLaboral.documentos = exp.complianceLaboral.documentos || {};
    exp.complianceLaboral.documentos[docId] = valor;
  });
}

// --- Tab: Fase 5 — comprobantes, retenciones y pago -------------------------
function tabPago(exp) {
  const p = Object.assign(nuevoPago(), exp.pago || {});
  p.retenciones = Object.assign({ ganancias: 0, suss: 0, iibb: 0, iva: 0 }, p.retenciones || {});
  const prov = presupuestoSeleccionado(exp);
  if (!prov) return `<div class="empty-state-mini">Primero seleccioná un presupuesto en la Fase 1.</div>`;
  if (!exp.vistoBuenoContratacion.aprobado) {
    return `<div class="empty-state-mini">El pago se carga después del Visto Bueno de contratación.</div>`;
  }
  const esperado = tipoFacturaEsperado(exp);
  const problemas = problemasPago(exp);
  const parecidos = pagosParecidos(exp);
  const fl = p.retencionesFlags || {};
  const totalRet = r2(p.retenciones.ganancias + p.retenciones.suss + p.retenciones.iibb + p.retenciones.iva);
  const difPresupuesto = num(p.totalFactura) && Math.abs(num(p.totalFactura) - num(prov.monto)) > Math.max(1, num(prov.monto) * 0.02);
  return `
  ${parecidos.length ? `<div class="alerta alerta-red"><span>⚠️</span><div><strong>Posible pago repetido</strong><p>Este proveedor ya tiene ${parecidos.length} pago(s) por el mismo importe en los últimos 90 días: ${parecidos.map(e => esc(e.tipoServicio) + ' (factura ' + esc((e.pago || {}).numeroFactura || 's/n') + ')').join(', ')}. Confirmá que no sea el mismo trabajo antes de aprobar.</p></div></div>` : ''}
  ${difPresupuesto ? `<div class="alerta alerta-amber"><span>📄</span><div><strong>La factura no coincide con el presupuesto aprobado</strong><p>Presupuesto ${fmtMoneda(prov.monto)} · Factura ${fmtMoneda(p.totalFactura)}. Dejá la explicación en las observaciones del Visto Bueno de pago.</p></div></div>` : ''}
  ${bloquePlanillaRetenciones(exp, p)}
  <div class="card card-narrow">
    <h3>Factura del proveedor</h3>
    <form onsubmit="guardarPago(event,'${esc(exp.id)}')" id="form-pago">
      <label class="check-item check-item-form">
        <input type="checkbox" name="caeValidado" ${p.caeValidado ? 'checked' : ''}>
        <div><strong>CAE / CAEA validado en ARCA</strong><span>Verificado en el sistema de validación de comprobantes previo a la orden de pago.</span></div>
      </label>
      <label>N° de CAE (opcional)<input name="cae" value="${esc(p.cae)}"></label>
      <label>Tipo de factura${esperado ? ` — por la categoría del proveedor corresponde <strong>${esperado}</strong>` : ''}
        <select name="tipoFactura" required><option value="">Elegir…</option><option ${p.tipoFactura === 'B' ? 'selected' : ''}>B</option><option ${p.tipoFactura === 'C' ? 'selected' : ''}>C</option></select>
      </label>
      <label>Número de comprobante (punto de venta y número)<input name="numeroFactura" required value="${esc(p.numeroFactura)}" placeholder="00003-00001234"></label>
      <label>Fecha de la factura<input type="date" name="fechaFactura" required min="2000-01-01" max="2099-12-31" value="${esc(p.fechaFactura)}"></label>
      <label>Importe neto, sin IVA (ARS)<input type="number" step="0.01" min="0" name="montoNeto" required value="${esc(p.montoNeto || '')}"></label>
      <label>IVA facturado (ARS) — 0 en factura C<input type="number" step="0.01" min="0" name="montoIva" value="${esc(p.montoIva || 0)}"></label>
      <label>Total de la factura (ARS)<input type="number" step="0.01" min="0" name="totalFactura" required value="${esc(p.totalFactura || '')}"></label>
      <label>Archivo de la factura (se guarda en tu Drive)${p.facturaUrl ? ` — <a href="${esc(p.facturaUrl)}" target="_blank" rel="noopener">ver la cargada</a>` : ''}<input type="file" name="facturaArchivo" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"></label>

      <h3 style="margin-top:18px;">Retenciones</h3>
      <p class="text-muted">Marcá las que corresponden y tocá "Calcular": la app propone los importes según los parámetros de Retenciones${(exp.validacionFiscal || {}).categoria ? ' y la categoría del proveedor' : ''}. Podés corregirlos a mano.</p>
      <label class="check-item check-item-form"><input type="checkbox" name="aplicaSUSS" ${fl.suss ? 'checked' : ''}><div><strong>Aplica retención SUSS</strong><span>Servicios de limpieza, seguridad, mantenimiento y similares alcanzados por el régimen.</span></div></label>
      <label class="check-item check-item-form"><input type="checkbox" name="aplicaIIBB" ${fl.iibb ? 'checked' : ''}><div><strong>Aplica retención de Ingresos Brutos (AGIP)</strong><span>Según la alícuota del padrón cargada en la Fase 2.</span></div></label>
      <label class="check-item check-item-form"><input type="checkbox" name="aplicaIVA" ${fl.iva ? 'checked' : ''}><div><strong>Aplica retención de IVA</strong><span>Solo si el consorcio es agente de retención para este tipo de servicio.</span></div></label>
      <div class="btn-row" style="margin-bottom:12px;"><button class="btn btn-secondary" type="button" onclick="calcularRetencionesForm('${esc(exp.id)}')">Calcular retenciones</button></div>
      <div id="detalle-retenciones" class="text-muted" style="font-size:12.5px;margin-bottom:10px;">${p.retencionesCalculadas ? esc(p.retencionesCalculadas.detalle.join(' ')) : ''}</div>
      <label>Retención Ganancias (ARS)<input type="number" step="0.01" min="0" name="retGanancias" value="${esc(p.retenciones.ganancias || 0)}"></label>
      <label>Retención SUSS (ARS)<input type="number" step="0.01" min="0" name="retSUSS" value="${esc(p.retenciones.suss || 0)}"></label>
      <label>Retención IIBB (ARS)<input type="number" step="0.01" min="0" name="retIIBB" value="${esc(p.retenciones.iibb || 0)}"></label>
      <label>Retención IVA (ARS)<input type="number" step="0.01" min="0" name="retIVA" value="${esc(p.retenciones.iva || 0)}"></label>

      <h3 style="margin-top:18px;">Pago</h3>
      <label>Medio de pago
        <select name="medioPago" required>
          <option value="">Seleccionar...</option>
          ${MEDIOS_PAGO_VALIDOS.map(m => `<option ${p.medioPago === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select>
      </label>
      <label>Fecha de pago<input type="date" name="fechaPago" required min="2000-01-01" max="2099-12-31" value="${esc(p.fechaPago)}"></label>
      <p class="text-muted">⚠️ El pago en efectivo está estrictamente prohibido (Ley 25.345) e invalida la deducibilidad fiscal y la rendición de cuentas.</p>
      <button class="btn btn-primary" type="submit">Guardar</button>
    </form>
  </div>
  ${num(p.totalFactura) ? `<div class="card card-narrow"><h3>Monto neto a pagar</h3><div class="monto-destacado">${fmtMoneda(p.montoAPagar)}</div>
    <p class="text-muted">Factura ${fmtMoneda(p.totalFactura)} − retenciones ${fmtMoneda(totalRet)} (Ganancias ${fmtMoneda(p.retenciones.ganancias)} · SUSS ${fmtMoneda(p.retenciones.suss)} · IIBB ${fmtMoneda(p.retenciones.iibb)} · IVA ${fmtMoneda(p.retenciones.iva)})</p></div>` : ''}
  ${problemas.length && num(p.totalFactura) ? `<div class="alerta alerta-amber"><span>📋</span><div><strong>Para aprobar el pago falta:</strong><p>${problemas.map(esc).join('<br>')}</p></div></div>` : ''}
  `;
}

// --- Vínculo con la planilla de Retenciones del consorcio -------------------
function bloquePlanillaRetenciones(exp, p) {
  if (!tienePlanillaRetenciones(exp)) {
    return `<div class="alerta alerta-blue"><span>ℹ️</span><div><strong>Este consorcio no tiene planilla de Retenciones vinculada</strong>
      <p>Las retenciones se calculan acá con los parámetros del menú Retenciones. Si el consorcio usa la planilla, vinculala en la app principal (Todos los consorcios → ID de la planilla de Retenciones ARCA).</p></div></div>`;
  }
  const vinc = p.retencionPlanilla;
  const datos = S.datosPago[exp.id];
  let lista = '';
  if (datos) {
    const avisos = (datos.avisos || []).map(a => `<p class="text-muted" style="color:var(--amber);">${esc(a)}</p>`).join('');
    lista = avisos + (datos.pagos.length ? datos.pagos.map(r => {
      const usadoOtro = r.usadoPor && r.usadoPor.id !== exp.id;
      const esEste = vinc && vinc.clave === r.clave;
      return `<div class="alerta ${esEste ? 'alerta-gold' : 'alerta-blue'}"><span>${esEste ? '✅' : '📄'}</span><div style="flex:1;">
        <strong>${esc(r.fecha)} — ${fmtMoneda(r.importeTotal)} (fila ${esc(r.fila)})</strong>
        <p>${esc(r.descripcion || '')}${r.codigoRegimen ? ' · cód. ' + esc(r.codigoRegimen) : ''} · Ganancias ${fmtMoneda(r.gananciasRetenido)} · SUSS ${fmtMoneda(r.sussRetenido)} · IVA ${fmtMoneda(r.ivaRetenido)} · Neto a pagar ${fmtMoneda(r.netoFinal)}${r.comprobante ? ' · Comprobante ' + esc(r.comprobante) : ''}${r.nCertificado ? ' · Certificado ' + esc(r.nCertificado) : ''}</p>
        ${usadoOtro ? `<p style="color:var(--red);">Ya está usado en otro expediente: ${esc(r.usadoPor.servicio || r.usadoPor.id)}.</p>` :
          esEste ? '<p>Vinculado a este expediente.</p>' : `<button class="btn btn-sm btn-secondary" type="button" onclick="usarFilaRetencion('${esc(exp.id)}','${esc(r.clave)}')">Usar este pago</button>`}
      </div></div>`;
    }).join('') : `<p class="text-muted">No hay pagos de este proveedor (CUIT ${esc((presupuestoSeleccionado(exp) || {}).proveedorCuit)}) en la planilla de Retenciones. Cargalo allá y volvé a buscar.</p>`);
  }
  return `<div class="card card-narrow">
    <h3>Planilla de Retenciones del consorcio</h3>
    <p class="text-muted">Las retenciones las calcula esa planilla. Elegí la fila de este pago: se copian el importe, las retenciones, el certificado y el neto a transferir. Cada fila respalda un solo expediente.</p>
    ${vinc ? `<p><strong>Vinculado:</strong> fila ${esc(vinc.fila)} del ${esc(vinc.fecha)} — ${fmtMoneda(vinc.importeTotal)}${vinc.nCertificado ? ' — certificado ' + esc(vinc.nCertificado) : ''}</p>` : ''}
    <div class="btn-row" style="margin-bottom:10px;"><button class="btn btn-secondary" type="button" onclick="buscarEnPlanillaRetenciones(this,'${esc(exp.id)}')">${datos ? 'Volver a buscar' : 'Buscar en la planilla de Retenciones'}</button></div>
    ${lista}
  </div>`;
}

async function buscarEnPlanillaRetenciones(btn, expId) {
  const exp = getExpediente(expId);
  const prov = presupuestoSeleccionado(exp) || {};
  if (btn) { btn.disabled = true; btn.textContent = 'Buscando…'; }
  try { S.datosPago[expId] = await Api.datosPago(exp.consorcioId, prov.proveedorCuit); }
  catch (e) { alert(e.message); }
  render();
}

function usarFilaRetencion(expId, clave) {
  const datos = S.datosPago[expId];
  const r = datos && datos.pagos.find(x => x.clave === clave);
  const f = document.getElementById('form-pago');
  if (!r || !f) return;
  const iso = (t) => { const m = String(t || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
  f.totalFactura.value = r.importeTotal;
  // Neto e IVA salen de la misma fila: no hace falta tipearlos (y no pueden quedar distintos).
  if (r.netoSinIva > 0) { f.montoNeto.value = r.netoSinIva; f.montoIva.value = r.ivaContenido || 0; }
  if (!f.numeroFactura.value && r.comprobante) f.numeroFactura.value = r.comprobante;
  if (!f.fechaPago.value) f.fechaPago.value = iso(r.fecha);
  f.retGanancias.value = r.gananciasRetenido; f.retSUSS.value = r.sussRetenido; f.retIVA.value = r.ivaRetenido;
  f.dataset.retencionPlanilla = JSON.stringify({
    clave: r.clave, fila: r.fila, fecha: r.fecha, importeTotal: r.importeTotal, codigoRegimen: r.codigoRegimen,
    nCertificado: r.nCertificado, comprobante: r.comprobante, ganancias: r.gananciasRetenido, suss: r.sussRetenido,
    iva: r.ivaRetenido, totalRetenido: r.totalRetenido, netoFinal: r.netoFinal,
  });
  document.getElementById('detalle-retenciones').textContent = `Datos tomados de la fila ${r.fila} de la planilla de Retenciones (${r.fecha}). ${r.netoSinIva > 0 ? 'Completá' : 'Completá neto, IVA,'} número y fecha de factura y tocá Guardar.`;
  f.scrollIntoView({ behavior: 'smooth' });
}

function leerPagoDelForm(f, exp) {
  const anterior = Object.assign(nuevoPago(), exp.pago || {});
  const pago = Object.assign({}, anterior, {
    caeValidado: f.caeValidado.checked,
    cae: f.cae.value.trim(),
    tipoFactura: f.tipoFactura.value,
    numeroFactura: f.numeroFactura.value.trim(),
    fechaFactura: f.fechaFactura.value,
    montoNeto: r2(num(f.montoNeto.value)),
    montoIva: r2(num(f.montoIva.value)),
    totalFactura: r2(num(f.totalFactura.value)),
    retenciones: { ganancias: r2(num(f.retGanancias.value)), suss: r2(num(f.retSUSS.value)), iibb: r2(num(f.retIIBB.value)), iva: r2(num(f.retIVA.value)) },
    retencionesFlags: { suss: f.aplicaSUSS.checked, iibb: f.aplicaIIBB.checked, iva: f.aplicaIVA.checked },
    medioPago: f.medioPago.value,
    fechaPago: f.fechaPago.value,
  });
  if (f.dataset.retencionPlanilla) pago.retencionPlanilla = JSON.parse(f.dataset.retencionPlanilla);
  const ret = pago.retenciones;
  pago.montoAPagar = r2(pago.totalFactura - ret.ganancias - ret.suss - ret.iibb - ret.iva);
  return pago;
}

function calcularRetencionesForm(expId) {
  const f = document.getElementById('form-pago');
  const exp = getExpediente(expId);
  exp.pago = leerPagoDelForm(f, exp);
  if (!(exp.pago.montoNeto > 0)) { alert('Cargá primero el importe neto de la factura.'); return; }
  const { r, detalle } = calcularRetenciones(exp, exp.pago.retencionesFlags);
  f.retGanancias.value = r.ganancias; f.retSUSS.value = r.suss; f.retIIBB.value = r.iibb; f.retIVA.value = r.iva;
  document.getElementById('detalle-retenciones').textContent = detalle.join(' ');
  f.dataset.calculo = JSON.stringify({ fecha: new Date().toISOString(), detalle, sugerido: r });
}

async function guardarPago(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const exp = getExpediente(expId);
  const pago = leerPagoDelForm(f, exp);
  if (pago.montoAPagar < 0) { alert('Las retenciones superan el total de la factura. Revisá los importes.'); return; }
  if (Math.abs(r2(pago.montoNeto + pago.montoIva) - pago.totalFactura) > 1) {
    if (!confirm('Neto + IVA (' + fmtMoneda(pago.montoNeto + pago.montoIva) + ') no coincide con el total (' + fmtMoneda(pago.totalFactura) + '). ¿Guardar igual para corregir después?')) return;
  }
  const esperado = tipoFacturaEsperado(exp);
  if (esperado && pago.tipoFactura && pago.tipoFactura !== esperado) alert(`Atención: por la categoría del proveedor la factura tendría que ser ${esperado}. No se va a poder aprobar el pago así.`);
  const prueba = clonar(exp); prueba.pago = pago;
  const dup = facturaDuplicada(prueba);
  if (dup) { alert(`La factura ${pago.numeroFactura} de este proveedor ya está cargada en otro expediente (${dup.tipoServicio || dup.id}). No se puede pagar dos veces.`); return; }
  if (f.dataset.calculo) pago.retencionesCalculadas = JSON.parse(f.dataset.calculo);
  await conBoton(f.querySelector('button[type="submit"]'), async () => {
    const file = f.facturaArchivo.files[0];
    if (file) {
      const cons = getConsorcio(exp.consorcioId);
      try { pago.facturaUrl = await Api.subirArchivo(file, `Contrataciones - ${cons ? cons.nombre : 'Sin consorcio'}`); }
      catch (e) { if (!confirm('No se pudo subir la factura (' + e.message + '). ¿Guardar los datos sin el archivo?')) return; }
    }
    const vincAnterior = exp.pago && exp.pago.retencionPlanilla ? exp.pago.retencionPlanilla.clave : '';
    exp.pago = pago;
    if (pago.retencionPlanilla && pago.retencionPlanilla.clave !== vincAnterior) {
      logExpediente(exp, `Vinculado con la fila ${pago.retencionPlanilla.fila} de la planilla de Retenciones (${pago.retencionPlanilla.fecha}, ${fmtMoneda(pago.retencionPlanilla.importeTotal)}).`);
    }
    logExpediente(exp, `Factura ${pago.tipoFactura} ${pago.numeroFactura}: total ${fmtMoneda(pago.totalFactura)}, retenciones ${fmtMoneda(pago.totalFactura - pago.montoAPagar)}, a pagar ${fmtMoneda(pago.montoAPagar)}.`);
    await guardarExp(exp);
  });
}

// --- Tab: Vistos buenos ------------------------------------------------------
function tabVistosBuenos(exp, consorcio) {
  const puedeContratar = puedeVistoBuenoContratacion(exp);
  const puedePagar = puedeVistoBuenoPago(exp);
  const resumen = generarResumenExpediente(exp, consorcio);
  const problemas = exp.vistoBuenoContratacion.aprobado ? problemasPago(exp) : [];
  const parecidos = pagosParecidos(exp);
  const nombre = loadAdmin().nombre;

  return `
  <div class="grid-2">
    <div class="card vb-card ${exp.vistoBuenoContratacion.aprobado ? 'vb-aprobado' : ''}">
      <h3>Visto Bueno para contratar</h3>
      <p class="text-muted">Requiere las Fases 1 a 4 completas. Una vez aprobado, lo contratado queda fijo.</p>
      ${resumenFases(exp)}
      ${exp.vistoBuenoContratacion.aprobado ? `
        <div class="vb-aprobado-info">✅ Aprobado por <strong>${esc(exp.vistoBuenoContratacion.por)}</strong> el ${esc(fmtFecha(String(exp.vistoBuenoContratacion.fecha).slice(0, 10)))}</div>
      ` : `
        <form onsubmit="aprobarContratacion(event,'${esc(exp.id)}')">
          <label>Aprobado por<input required name="por" value="${esc(nombre)}"></label>
          <label>Observaciones<textarea name="observaciones" rows="2"></textarea></label>
          <button class="btn btn-primary" type="submit" ${puedeContratar ? '' : 'disabled'}>
            ${puedeContratar ? 'Dar Visto Bueno y habilitar contratación' : 'Faltan fases por completar'}
          </button>
        </form>`}
    </div>

    <div class="card vb-card ${exp.vistoBuenoPago.aprobado ? 'vb-aprobado' : ''}">
      <h3>Visto Bueno para liberar el pago</h3>
      <p class="text-muted">Requiere Visto Bueno de contratación + Fase 5 completa. El servidor rechaza una factura ya pagada en otro expediente.</p>
      ${problemas.length && !exp.vistoBuenoPago.aprobado ? `<ul class="lista-fases">${problemas.map(t => `<li>⬜ ${esc(t)}</li>`).join('')}</ul>` : ''}
      ${parecidos.length && !exp.vistoBuenoPago.aprobado ? `<p class="text-muted" style="color:var(--red);">⚠️ Hay ${parecidos.length} pago(s) a este proveedor por el mismo importe en los últimos 90 días. Revisalo en la Fase 5.</p>` : ''}
      ${exp.vistoBuenoPago.aprobado ? `
        <div class="vb-aprobado-info">✅ Aprobado por <strong>${esc(exp.vistoBuenoPago.por)}</strong> el ${esc(fmtFecha(String(exp.vistoBuenoPago.fecha).slice(0, 10)))}</div>
      ` : `
        <form onsubmit="aprobarPago(event,'${esc(exp.id)}')">
          <label>Aprobado por<input required name="por" value="${esc(nombre)}"></label>
          <label>Observaciones${parecidos.length ? ' (obligatorias: explicá por qué no es un pago repetido)' : ''}<textarea name="observaciones" rows="2" ${parecidos.length ? 'required' : ''}></textarea></label>
          <button class="btn btn-primary" type="submit" ${puedePagar ? '' : 'disabled'}>
            ${puedePagar ? 'Dar Visto Bueno y liberar el pago' : 'Faltan requisitos por completar'}
          </button>
        </form>`}
    </div>
  </div>

  ${bloquePagoRealizado(exp)}

  <div class="card">
    <h3>Resumen del expediente</h3>
    <pre class="preview-text">${esc(resumen)}</pre>
    <div class="btn-row">
      ${botonCopiar('resumen_' + exp.id, resumen, 'Copiar resumen')}
      ${botonImprimir('resumenP_' + exp.id, 'Resumen de Expediente', resumen)}
    </div>
  </div>

  ${!exp.vistoBuenoPago.aprobado && !estaAnulado(exp) ? `
  <div class="card card-narrow">
    <h3>Anular expediente</h3>
    <p class="text-muted">Si el trabajo no se va a hacer (o se cargó por error). Queda en el historial con el motivo; no se borra.</p>
    <form onsubmit="anularExpediente(event,'${esc(exp.id)}')">
      <label>Motivo<textarea name="motivo" rows="2" required minlength="5"></textarea></label>
      <button class="btn btn-ghost" type="submit">Anular expediente</button>
    </form>
  </div>` : ''}

  <div class="card">
    <h3>Historial del expediente</h3>
    <ul class="historial">
      ${(exp.historial || []).map(h => `<li><span class="text-muted">${esc(new Date(h.fecha).toLocaleString('es-AR', { hourCycle: 'h23' }))}</span> — ${esc(h.texto)}</li>`).join('')}
    </ul>
  </div>
  `;
}

// --- Registrar pago realizado (después de hacer la transferencia) --------------
function bloquePagoRealizado(exp) {
  if (!exp.vistoBuenoPago.aprobado) return '';
  const pr = exp.pagoRealizado;
  if (pr && pr.fecha) {
    return `<div class="card vb-card vb-aprobado"><h3>Pago realizado</h3>
      <div class="vb-aprobado-info">✅ Pagado el ${esc(fmtFechaCorta(pr.fecha))}${pr.referencia ? ' — operación ' + esc(pr.referencia) : ''}${pr.comprobanteUrl ? ` — <a href="${esc(pr.comprobanteUrl)}" target="_blank" rel="noopener">comprobante</a>` : ''}</div>
      <p class="text-muted">Cargado en Gastos_Mensual (${esc(pr.rubroGastos)}, Fondo ${esc(pr.fondo)}), retenciones, historial de mantenimiento y lista de proveedores del consorcio.</p></div>`;
  }
  const datos = S.datosPago[exp.id];
  const rubros = datos ? datos.rubros || [] : null;
  const p = exp.pago || {};
  return `<div class="card card-narrow">
    <h3>Registrar pago realizado</h3>
    <p class="text-muted">Después de hacer la transferencia. En un solo paso se carga el gasto en la liquidación del consorcio (Gastos_Mensual, con la factura), las retenciones, el historial de mantenimiento y el proveedor. No se puede cargar dos veces.</p>
    <form onsubmit="registrarPagoRealizado(event,'${esc(exp.id)}')">
      <label>Fecha en que se hizo el pago<input type="date" name="fechaPago" required min="2000-01-01" max="2099-12-31" value="${esc(p.fechaPago || '')}"></label>
      <label>N° de operación / transferencia<input name="referencia" placeholder="Opcional"></label>
      <label>Comprobante de la transferencia (se guarda en tu Drive)<input type="file" name="comprobante" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"></label>
      <label>Rubro del gasto en la liquidación
        ${rubros && rubros.length
          ? `<select name="rubroGastos" required><option value="">Elegir…</option>${rubros.map(r => `<option ${/manten|repar/i.test(r) && rubros.filter(x => /manten|repar/i.test(x)).length === 1 ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`
          : `<input name="rubroGastos" required placeholder="Ej: 4 - Mantenimiento y Reparaciones">${rubros ? '' : ` <button class="btn btn-sm btn-ghost nk-libre" type="button" onclick="buscarEnPlanillaRetenciones(this,'${esc(exp.id)}')">Traer rubros de la planilla</button>`}`}
      </label>
      <label>Fondo
        <select name="fondo"><option value="A">Fondo A (ordinario)</option><option value="B">Fondo B (extraordinario / reserva)</option></select>
      </label>
      <button class="btn btn-primary" type="submit">Registrar pago realizado</button>
    </form>
  </div>`;
}

async function registrarPagoRealizado(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const exp = getExpediente(expId);
  const datos = { expedienteId: expId, fechaPago: f.fechaPago.value, referencia: f.referencia.value.trim(), rubroGastos: f.rubroGastos.value.trim(), fondo: f.fondo.value };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaPago)) { alert('Revisá la fecha del pago.'); return; }
  if (new Date(datos.fechaPago + 'T12:00:00') > new Date()) { alert('La fecha del pago no puede ser futura: registralo después de hacer la transferencia.'); return; }
  if (!confirm(`Se registra el pago de ${fmtMoneda(exp.pago.totalFactura)} a ${(presupuestoSeleccionado(exp) || {}).proveedorNombre} en la liquidación (${datos.rubroGastos}, Fondo ${datos.fondo}). ¿Confirmás?`)) return;
  await conBoton(f.querySelector('button[type="submit"]'), async () => {
    const file = f.comprobante.files[0];
    if (file) {
      const cons = getConsorcio(exp.consorcioId);
      try { datos.comprobanteUrl = await Api.subirArchivo(file, `Contrataciones - ${cons ? cons.nombre : 'Sin consorcio'}`); }
      catch (e) { if (!confirm('No se pudo subir el comprobante (' + e.message + '). ¿Registrar el pago igual?')) return; }
    }
    try {
      const d = await Api.registrarPago(datos);
      if (!d.ok) { alert(d.error || 'No se pudo registrar el pago.'); return; }
      const i = S.expedientes.findIndex(x => x.id === expId);
      if (i >= 0) S.expedientes[i] = d.expediente;
      (d.avisos || []).forEach(a => alert(a));
      if (d.gastoYaEstabaCargado) alert('El gasto ya estaba cargado en la liquidación: no se duplicó.');
      render();
    } catch (e) {
      alert('No se pudo confirmar el registro: ' + e.message + '\nAntes de reintentar, recargá la página: puede que se haya registrado igual (no se duplica si lo repetís).');
    }
  });
}

function resumenFases(exp) {
  const fases = [
    ['Fase 1 · Presupuesto', fase1Completa(exp)],
    ['Fase 2 · Validación fiscal', fase2Completa(exp)],
    ['Fase 3 · Instrumentación', fase3Completa(exp)],
    ['Fase 4 · Compliance laboral', fase4Completa(exp)],
  ];
  return `<ul class="lista-fases">${fases.map(([label, ok]) => `<li>${ok ? '✅' : '⬜'} ${esc(label)}</li>`).join('')}</ul>`;
}

async function aprobarContratacion(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const exp = getExpediente(expId);
  if (!puedeVistoBuenoContratacion(exp)) return;
  if (!confirm('Al dar el Visto Bueno, el proveedor, el presupuesto y la documentación quedan fijos y no se pueden cambiar. ¿Confirmás?')) return;
  await conBoton(f.querySelector('button[type="submit"]'), async () => {
    exp.vistoBuenoContratacion = { aprobado: true, por: f.por.value.trim(), fecha: new Date().toISOString(), observaciones: f.observaciones.value.trim() };
    logExpediente(exp, `Visto Bueno de CONTRATACIÓN aprobado por ${f.por.value.trim()}.`);
    await guardarExp(exp);
  });
}
async function aprobarPago(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const exp = getExpediente(expId);
  if (!puedeVistoBuenoPago(exp)) return;
  if (!confirm(`Se aprueba el pago de ${fmtMoneda(exp.pago.montoAPagar)} a ${(presupuestoSeleccionado(exp) || {}).proveedorNombre}. Después no se puede modificar. ¿Confirmás?`)) return;
  await conBoton(f.querySelector('button[type="submit"]'), async () => {
    exp.vistoBuenoPago = { aprobado: true, por: f.por.value.trim(), fecha: new Date().toISOString(), observaciones: f.observaciones.value.trim() };
    logExpediente(exp, `Visto Bueno de PAGO aprobado por ${f.por.value.trim()}: ${fmtMoneda(exp.pago.montoAPagar)}.`);
    await guardarExp(exp);
  });
}
async function anularExpediente(ev, expId) {
  ev.preventDefault();
  const f = ev.target;
  const motivo = f.motivo.value.trim();
  if (motivo.length < 5) { alert('Escribí el motivo.'); return; }
  if (!confirm('¿Anular el expediente? No se puede deshacer.')) return;
  await conBoton(f.querySelector('button[type="submit"]'), async () => {
    const exp = getExpediente(expId);
    exp.anulado = { fecha: new Date().toISOString(), motivo, por: loadAdmin().nombre };
    logExpediente(exp, `Expediente ANULADO: ${motivo}`);
    await guardarExp(exp);
  });
}

// ---------------------------------------------------------------------------
// Importación de la versión anterior (datos guardados solo en este navegador)
// ---------------------------------------------------------------------------
function dataUrlABlob(dataUrl, nombre) {
  const [cab, datos] = String(dataUrl).split(',');
  const mime = (cab.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(datos || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], nombre || 'archivo', { type: mime });
}

async function importarDatosViejos(btn) {
  let viejos = [], consViejos = [];
  try { viejos = JSON.parse(localStorage.getItem(LS_VIEJO.expedientes) || '[]'); consViejos = JSON.parse(localStorage.getItem(LS_VIEJO.consorcios) || '[]'); } catch (e) {}
  if (!viejos.length) return;
  if (!confirm(`Se van a pasar ${viejos.length} expediente(s) al servidor. Los datos de este navegador no se borran. ¿Seguir?`)) return;
  btn.disabled = true;
  const sinConsorcio = [];
  let ok = 0;
  const datosCons = clonar(S.datosConsorcios);
  for (const v of viejos) {
    btn.textContent = `Importando ${ok + 1} de ${viejos.length}…`;
    if (S.expedientes.some(e => e.id === v.id)) { ok++; continue; }
    const cv = consViejos.find(c => c.id === v.consorcioId) || {};
    const ed = S.edificios.find(e => (cv.spreadsheetId && e.spreadsheetId === cv.spreadsheetId) || (cv.nombre && e.nombre.trim().toLowerCase() === String(cv.nombre).trim().toLowerCase()));
    if (!ed) { sinConsorcio.push(v.tipoServicio || v.id); continue; }
    if (!datosCons[ed.id] && (cv.cuit || cv.direccion)) datosCons[ed.id] = { cuit: cv.cuit || '', direccion: cv.direccion || '' };
    const exp = nuevoExpediente(clonar(v));
    exp.consorcioId = ed.id;
    exp.version = 0;
    exp.importadoDeNavegador = true;
    for (const p of exp.presupuestos || []) {
      p.garantiaMeses = p.garantiaMeses || 0;
      if (p.archivoDataUrl) {
        try { p.archivoUrl = await Api.subirArchivo(dataUrlABlob(p.archivoDataUrl, p.archivoNombre), `Contrataciones - ${ed.nombre}`); } catch (e) { p.notas = (p.notas || '') + ' [No se pudo subir el archivo al importar]'; }
      }
      delete p.archivoDataUrl;
    }
    const vp = v.pago || {};
    exp.pago = Object.assign(nuevoPago(), {
      caeValidado: !!vp.caeValidado, tipoFactura: vp.tipoFactura || '', numeroFactura: vp.numeroFactura || '',
      totalFactura: num(vp.montoAPagar) + num(vp.montoRetSUSS) + num(vp.montoRetAGIP),
      retenciones: { ganancias: 0, suss: num(vp.montoRetSUSS), iibb: num(vp.montoRetAGIP), iva: 0 },
      medioPago: vp.medioPago || '', montoAPagar: num(vp.montoAPagar),
    });
    logExpediente(exp, 'Importado al servidor desde la versión anterior (guardada en el navegador).');
    // Se importa con los vistos buenos que tenía; el servidor los registra en la planilla.
    if (await guardarExp(exp, { sinRender: true })) ok++;
  }
  try { await Api.guardarConfig('consorcios', datosCons); S.datosConsorcios = datosCons; } catch (e) {}
  if (!sinConsorcio.length) { try { localStorage.setItem(LS_VIEJO.importado, '1'); } catch (e) {} }
  alert(`Importados: ${ok} de ${viejos.length}.` + (sinConsorcio.length ? `\nNo se encontró el consorcio en la app principal para: ${sinConsorcio.join(', ')}. Dalo de alta allá (con la misma planilla) y volvé a importar.` : ''));
  render();
}
