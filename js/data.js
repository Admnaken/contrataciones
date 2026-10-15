/* ==========================================================================
   NAKEN · Contrataciones — data.js
   Modelo de datos, constantes y checklists legales derivados del
   "Protocolo Integral de Contratación de Servicios de Mantenimiento en PH (CABA)"
   ========================================================================== */

// ---------------------------------------------------------------------------
// Feriados AR (para cálculo de días hábiles en alertas).
// Los de fecha fija valen para cualquier año; los trasladables y los puentes
// hay que agregarlos cada año en FERIADOS_MOVILES.
// ---------------------------------------------------------------------------
const FERIADOS_FIJOS_MMDD = ['01-01', '03-24', '04-02', '05-01', '05-25', '06-20', '07-09', '12-08', '12-25'];
const FERIADOS_MOVILES = [
  '2026-02-16', '2026-02-17', '2026-03-27', '2026-04-03', '2026-06-17',
  '2026-08-17', '2026-10-12', '2026-11-20',
];

// ---------------------------------------------------------------------------
// Estados generales del expediente
// ---------------------------------------------------------------------------
const FASES = [
  { id: 'f1', key: 'solicitud',      label: 'Solicitud de presupuesto',      corto: 'F1 · Solicitud' },
  { id: 'f2', key: 'validacion',     label: 'Validación fiscal y técnica',   corto: 'F2 · Validación' },
  { id: 'f3', key: 'instrumentacion',label: 'Instrumentación jurídica',      corto: 'F3 · Instrumentación' },
  { id: 'f4', key: 'laboral',        label: 'Compliance laboral',            corto: 'F4 · Laboral' },
  { id: 'f5', key: 'pago',           label: 'Comprobantes y pago',           corto: 'F5 · Pago' },
];

const ESTADO_EXPEDIENTE = {
  BORRADOR: 'borrador',
  EN_PRESUPUESTOS: 'en_presupuestos',
  EN_VALIDACION: 'en_validacion',
  EN_INSTRUMENTACION: 'en_instrumentacion',
  EN_COMPLIANCE_LABORAL: 'en_compliance_laboral',
  LISTO_PARA_CONTRATAR: 'listo_para_contratar',
  CONTRATADO: 'contratado',
  EN_EJECUCION: 'en_ejecucion',
  LISTO_PARA_PAGAR: 'listo_para_pagar',
  PAGADO: 'pagado',
  CERRADO: 'cerrado',
  RECHAZADO: 'rechazado',
  ANULADO: 'anulado',
};

const ESTADO_META = {
  borrador:               { label: 'Borrador',                    color: 'slate'  },
  en_presupuestos:        { label: 'Esperando presupuestos',       color: 'blue'   },
  en_validacion:          { label: 'Validación fiscal en curso',   color: 'blue'   },
  en_instrumentacion:     { label: 'Instrumentación jurídica',     color: 'blue'   },
  en_compliance_laboral:  { label: 'Compliance laboral',           color: 'amber'  },
  listo_para_contratar:   { label: 'Listo — falta VB contratación',color: 'amber'  },
  contratado:             { label: 'Contratado',                   color: 'teal'   },
  en_ejecucion:           { label: 'En ejecución',                 color: 'teal'   },
  listo_para_pagar:       { label: 'Listo — falta VB de pago',     color: 'amber'  },
  pagado:                 { label: 'Pagado',                       color: 'gold'   },
  cerrado:                { label: 'Cerrado',                      color: 'green'  },
  rechazado:              { label: 'Rechazado',                    color: 'red'    },
  anulado:                { label: 'Anulado',                      color: 'red'    },
};

// ---------------------------------------------------------------------------
// FASE 1 — Requisitos obligatorios del presupuesto (Ley 941 / Disp. 856/14)
// ---------------------------------------------------------------------------
const REQUISITOS_PRESUPUESTO = [
  { id: 'r1', label: 'Datos de identificación completa',
    detalle: 'Nombre o Razón Social, CUIT, domicilio fiscal y comercial, teléfono y correo electrónico.' },
  { id: 'r2', label: 'Matrícula y habilitación',
    detalle: 'Matrícula profesional habilitante y/o registro ante la AGC (conservador de ascensores, gasista matriculado, Ley 257, etc.) cuando el rubro lo exige.' },
  { id: 'r3', label: 'Detalle técnico de trabajos y materiales',
    detalle: 'Descripción exhaustiva de tareas, marca, calidad y especificaciones técnicas de los materiales.' },
  { id: 'r4', label: 'Discriminación de costos',
    detalle: 'Mano de obra separada de materiales, con alícuota y monto de IVA discriminados.' },
  { id: 'r5', label: 'Plazo de ejecución e inicio',
    detalle: 'Duración estimada de las tareas y plazo límite de inicio tras la adjudicación.' },
  { id: 'r6', label: 'Validez de la oferta',
    detalle: 'Plazo de mantenimiento de precios cotizados (mínimo sugerido: 15 días).' },
  { id: 'r7', label: 'Términos y plazo de garantía',
    detalle: 'Cobertura de garantía por fallas de materiales o vicios de ejecución. Cargá los meses de garantía en el presupuesto: la app avisa si el mismo trabajo se repite mientras está vigente.' },
  { id: 'r8', label: 'Nómina de seguros',
    detalle: 'Declaración jurada de ART (personal en relación de dependencia) o Seguro de Accidentes Personales (autónomos), con compromiso de Cláusula de No Repetición/Indemnidad.' },
];

// ---------------------------------------------------------------------------
// FASE 2 — Validación fiscal y técnica pre-adjudicación
// ---------------------------------------------------------------------------
const CATEGORIA_RI = 'Responsable Inscripto (Factura B)';
const CATEGORIA_MONO = 'Monotributista (Factura C)';
const VALIDACION_FISCAL_CAMPOS = [
  { id: 'cuitActivo', tipo: 'bool', label: 'CUIT en estado ACTIVO en ARCA (ex AFIP)',
    ayuda: 'Descargar la Constancia de Inscripción y verificar el estado.' },
  { id: 'categoria', tipo: 'select', label: 'Categoría impositiva',
    opciones: [CATEGORIA_RI, CATEGORIA_MONO, 'No determinado'] },
  { id: 'impuestosOk', tipo: 'bool', label: 'Impuestos registrados: IVA, Ganancias y Empleador (si aplica)',
    ayuda: 'Verificar en la Constancia de Inscripción que figuren los impuestos correspondientes a la actividad.' },
  { id: 'apocOk', tipo: 'bool', label: 'No figura en Base APOC (facturas apócrifas)',
    ayuda: 'Consultar con clave fiscal o en el sitio institucional de ARCA.' },
  { id: 'agipOk', tipo: 'bool', label: 'Consultado el padrón AGIP (alícuota IIBB)',
    ayuda: 'Alícuota de retención/percepción aplicable en Ingresos Brutos CABA.' },
  { id: 'agipAlicuota', tipo: 'text', label: 'Alícuota de retención IIBB (AGIP) — en %', placeholder: 'ej: 2.5' },
  { id: 'matriculaAplica', tipo: 'bool', label: '¿El rubro requiere habilitación matricular AGC / SART?',
    ayuda: 'Ascensores, calderas, incendio, desinsectación, fachadas Ley 257, etc.' },
  { id: 'matriculaOk', tipo: 'bool', label: 'Matrícula AGC / SART vigente (verificada por TAD)',
    ayuda: 'Solo si el campo anterior está marcado.' },
];

// ---------------------------------------------------------------------------
// FASE 3 — Instrumentación jurídica
// ---------------------------------------------------------------------------
const TIPO_INSTRUMENTACION = {
  PRESUPUESTO: 'presupuesto_aprobado',
  CONTRATO: 'contrato_locacion',
};

const CLAUSULAS_CONTRATO = [
  { id: 'c1', label: 'Objeto y alcance', detalle: 'Delimitación precisa de los trabajos o abono contratado.' },
  { id: 'c2', label: 'Autonomía técnica y jurídica', detalle: 'El contratista actúa con equipos y personal propio, sin relación de dependencia con el Consorcio ni la Administración.' },
  { id: 'c3', label: 'Cláusula de indemnidad y responsabilidad', detalle: 'Exoneración al Consorcio por daños a terceros, a cosas del edificio o accidentes del personal del contratista.' },
  { id: 'c4', label: 'Facultad de rescisión anticipada', detalle: 'El Consorcio puede rescindir sin indemnización ante incumplimiento fiscal, laboral, previsional o falta de coberturas.' },
];

// ---------------------------------------------------------------------------
// FASE 4 — Compliance laboral y previsional
// ---------------------------------------------------------------------------
const TIPO_PRESTADOR = {
  MONOTRIBUTISTA: 'monotributista',
  EMPRESA: 'empresa_con_personal',
};

const DOC_LABORAL_MONOTRIBUTISTA = [
  { id: 'segAccPersonales', label: 'Certificado de Seguro de Accidentes Personales vigente',
    detalle: 'Cobertura mínima actualizada por muerte e incapacidad, incluye cláusula in itinere.' },
  { id: 'clausulaNoRepeticion', label: 'Cláusula de No Repetición / Indemnidad a favor del Consorcio',
    detalle: 'Debe nombrar textualmente al "Consorcio de Propietarios de la calle [Dirección] CUIT [Número]".' },
  { id: 'pagoPoliza', label: 'Comprobante de pago de la póliza al día' },
];

const DOC_LABORAL_EMPRESA = [
  { id: 'artVigente', label: 'Certificado de cobertura de ART vigente' },
  { id: 'clausulaNoRepeticion', label: 'Cláusula de No Repetición a favor del Consorcio' },
  { id: 'nominaPersonal', label: 'Nómina del personal afectado (Nombre, DNI y CUIL)' },
  { id: 'f931', label: 'Copia del Formulario 931 (ARCA) del último período vencido' },
  { id: 'pagoF931', label: 'Ticket de pago bancario del F.931' },
];

// ---------------------------------------------------------------------------
// FASE 5 — Comprobantes, retenciones y pago
// ---------------------------------------------------------------------------
const MEDIOS_PAGO_VALIDOS = [
  'Transferencia bancaria',
  'eCheq',
  'Cheque cruzado "No a la Orden"',
];

// Parámetros de retención. Los importes mínimos cambian con la normativa: se
// cargan y actualizan desde "Retenciones" (quedan guardados en el servidor).
// Las alícuotas de Ganancias son las de RG 830 para locaciones de obra y
// servicios; el resto se completa según indique el contador.
const PARAMETROS_RETENCION_DEFAULT = {
  actualizado: '',
  ganancias: { alicuotaInscripto: 2, alicuotaNoInscripto: 28, minimoNoSujeto: 0, retencionMinima: 0 },
  suss: { alicuota: 0, minimo: 0 },
  iibb: { alicuotaPorDefecto: 0 },
  iva: { alicuota: 0 },
};

// ---------------------------------------------------------------------------
// Utilidades de fecha / días hábiles
// ---------------------------------------------------------------------------
function isoLocal(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
function esFeriado(fechaISO) {
  return FERIADOS_MOVILES.includes(fechaISO) || FERIADOS_FIJOS_MMDD.includes(fechaISO.slice(5));
}
function esFinDeSemana(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}
function diasHabilesDesde(fechaISO) {
  if (!fechaISO) return null;
  const inicio = new Date(fechaISO + 'T00:00:00');
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (isNaN(inicio.getTime())) return null;
  let count = 0;
  const cursor = new Date(inicio);
  while (cursor < hoy) {
    cursor.setDate(cursor.getDate() + 1);
    if (!esFinDeSemana(cursor) && !esFeriado(isoLocal(cursor))) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Fábrica de expediente nuevo
// ---------------------------------------------------------------------------
function nuevoPago() {
  return {
    caeValidado: false, cae: '', tipoFactura: '', numeroFactura: '', fechaFactura: '',
    montoNeto: 0, montoIva: 0, totalFactura: 0, facturaUrl: '',
    retenciones: { ganancias: 0, suss: 0, iibb: 0, iva: 0 },
    retencionesCalculadas: null,
    medioPago: '', fechaPago: '', montoAPagar: 0,
  };
}

function nuevoExpediente(datosIniciales) {
  const id = 'exp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  return Object.assign({
    id,
    version: 0,
    creado: new Date().toISOString(),
    actualizado: new Date().toISOString(),
    estado: ESTADO_EXPEDIENTE.BORRADOR,
    consorcioId: null,
    tipoServicio: '',
    tipoMantenimiento: 'preventivo', // preventivo | correctivo
    descripcion: '',
    areaInstalacion: '',
    fechaLimiteOferta: '',
    presupuestos: [],
    proveedorSeleccionadoId: null,
    validacionFiscal: {},
    instrumentacion: { tipo: null, clausulas: {}, contratoTexto: '', esRecurrente: false },
    complianceLaboral: { tipoPrestador: null, documentos: {}, vencimientos: {} },
    pago: nuevoPago(),
    vistoBuenoContratacion: { aprobado: false, por: '', fecha: '', observaciones: '' },
    vistoBuenoPago: { aprobado: false, por: '', fecha: '', observaciones: '' },
    anulado: null,
    historial: [{ fecha: new Date().toISOString(), texto: 'Expediente creado.' }],
  }, datosIniciales || {});
}

function nuevoPresupuesto(datosIniciales) {
  const id = 'pre_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const req = {};
  REQUISITOS_PRESUPUESTO.forEach(r => { req[r.id] = false; });
  return Object.assign({
    id,
    proveedorNombre: '',
    proveedorCuit: '',
    proveedorEmail: '',
    proveedorTelefono: '',
    monto: 0,
    garantiaMeses: 0,
    archivoNombre: '',
    archivoUrl: '',
    requisitos: req,
    notas: '',
    recibido: new Date().toISOString(),
  }, datosIniciales || {});
}
