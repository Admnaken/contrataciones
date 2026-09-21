/* ==========================================================================
   NAKEN · Contrataciones — templates.js
   Generadores de texto: email de pedido de presupuesto, contrato de
   locación de obra/servicios, y resumen del expediente para expensas.
   ========================================================================== */

function fmtFecha(iso) {
  if (!iso) return '[Fecha]';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtMoneda(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
}

function generarEmailPresupuesto(exp, consorcio, admin) {
  const direccion = (consorcio && consorcio.direccion) || '[Dirección del Edificio]';
  const cuit = (consorcio && consorcio.cuit) || '[CUIT del Consorcio]';
  const tipoMant = exp.tipoMantenimiento === 'correctivo' ? 'correctivo' : 'preventivo';
  const area = exp.areaInstalacion || '[Detallar Instalación/Área]';
  const detalle = exp.descripcion || '[Insertar detalle sumario de los trabajos requeridos]';
  const fechaLimite = exp.fechaLimiteOferta ? fmtFecha(exp.fechaLimiteOferta) : '[Fecha Límite]';
  const adminNombre = (admin && admin.nombre) || 'Lic. Sebastián Rubén Espeche';
  const matricula = (admin && admin.matricula) || '20.066';

  return `Asunto: Solicitud de Presupuesto Técnico - Mantenimiento ${tipoMant.charAt(0).toUpperCase() + tipoMant.slice(1)} de ${area} - Consorcio CUIT ${cuit}

Estimados [Nombre del Proveedor / Empresa]:

Me dirijo a ustedes en mi carácter de Administrador del Consorcio de Propietarios de la calle ${direccion}, CABA.

Solicito tengan a bien emitir y remitir la cotización/presupuesto correspondiente a la realización de las tareas de mantenimiento ${tipoMant} detalladas a continuación:

${detalle}

A fin de dar estricto cumplimiento a la Ley 941 de la Ciudad Autónoma de Buenos Aires y la Disposición DGCADC Nº 856/14, el presupuesto formal que nos remitan en archivo PDF deberá contener de manera obligatoria e indefectible los siguientes requisitos:

1. Datos de Identificación Completa: Nombre o Razón Social, CUIT, Domicilio Fiscal y Comercial, Teléfono y Correo Electrónico de contacto.
2. Matrícula y Habilitación: Indicación de la matrícula profesional habilitante y/o registro ante la AGC.
3. Detalle Técnico de Trabajos y Materiales: Descripción exhaustiva de las tareas a ejecutar, especificando marca, calidad, especificaciones técnicas y tipo de materiales a utilizar.
4. Discriminación de Costos: Separación expresa entre el costo de la mano de obra y el costo de los materiales, detallando la alícuota y monto del Impuesto al Valor Agregado (IVA).
5. Plazo de Ejecución e Inicio: Tiempo estimado de duración de las tareas y plazo límite de inicio tras la eventual adjudicación.
6. Validez de la Oferta: Plazo de mantenimiento de los precios cotizados (mínimo sugerido: 15 días).
7. Términos y Plazo de la Garantía: Detalle de la cobertura de garantía por fallas de materiales o vicios de ejecución posterior a la recepción de la obra/servicio.
8. Nómina de Seguros: Declaración jurada de contar con cobertura de ART para el personal en relación de dependencia o Seguro de Accidentes Personales para trabajadores independientes, comprometiéndose a presentar los certificados con Cláusula de No Repetición/Indemnidad a favor del Consorcio de forma previa al inicio de tareas.

Agradecemos enviar la propuesta antes del ${fechaLimite}. Quedamos a su disposición para coordinar la visita técnica al inmueble.

Atentamente,

Administración NAKEN
${adminNombre}
Administrador de Consorcios - Mat. RPA CABA N.º ${matricula}`;
}

function generarContratoLocacion(exp, consorcio, admin, presupuesto) {
  const direccion = (consorcio && consorcio.direccion) || '[Dirección del Edificio]';
  const cuitConsorcio = (consorcio && consorcio.cuit) || '[CUIT del Consorcio]';
  const adminNombre = (admin && admin.nombre) || 'Lic. Sebastián Rubén Espeche';
  const matricula = (admin && admin.matricula) || '20.066';
  const prov = presupuesto || {};
  const clausulas = (exp.instrumentacion && exp.instrumentacion.clausulas) || {};

  const clausulasTexto = CLAUSULAS_CONTRATO.map((c, i) => {
    const marcada = clausulas[c.id] ? '' : ' [PENDIENTE DE REVISIÓN]';
    return `${i + 1}. ${c.label.toUpperCase()}${marcada}\n${c.detalle}`;
  }).join('\n\n');

  return `CONTRATO DE LOCACIÓN DE OBRA / SERVICIOS

Entre el CONSORCIO DE PROPIETARIOS de la calle ${direccion}, CABA, CUIT ${cuitConsorcio}, representado en este acto por su administrador ${adminNombre} (Mat. RPA CABA N.º ${matricula}), en adelante "EL CONSORCIO"; y ${prov.proveedorNombre || '[Nombre del Contratista]'}, CUIT ${prov.proveedorCuit || '[CUIT]'}, en adelante "EL CONTRATISTA"; se conviene celebrar el presente contrato de locación de obra/servicios sujeto a las siguientes cláusulas, conforme los Arts. 1251 y ss. del Código Civil y Comercial de la Nación:

${clausulasTexto}

MONTO Y FORMA DE PAGO: según presupuesto aprobado de fecha ${fmtFecha(prov.recibido)}, por un monto total de ${fmtMoneda(prov.monto)}, IVA incluido según corresponda. El pago se realizará exclusivamente mediante transferencia bancaria, eCheq o cheque cruzado "No a la Orden" desde la cuenta del Consorcio, quedando prohibido el pago en efectivo (Ley 25.345).

DOCUMENTACIÓN PREVIA OBLIGATORIA: EL CONTRATISTA se obliga a presentar, con no menos de 48 horas de antelación al inicio de tareas, la totalidad de la documentación laboral y previsional exigida por EL CONSORCIO conforme el Art. 30 de la Ley de Contrato de Trabajo y el Art. 1753 del CCyCN.

Se firman dos ejemplares de un mismo tenor y a un solo efecto, en la Ciudad Autónoma de Buenos Aires, a los ${new Date().getDate()} días del mes de ${new Date().toLocaleDateString('es-AR', { month: 'long' })} de ${new Date().getFullYear()}.


_______________________________          _______________________________
Por EL CONSORCIO                          Por EL CONTRATISTA
${adminNombre}                            ${prov.proveedorNombre || ''}
Administrador - Mat. RPA N.º ${matricula}`;
}

function generarResumenExpediente(exp, consorcio) {
  const prov = (exp.presupuestos || []).find(p => p.id === exp.proveedorSeleccionadoId) || {};
  const lineas = [];
  lineas.push(`RESUMEN DE EXPEDIENTE DE CONTRATACIÓN`);
  lineas.push(`Consorcio: ${(consorcio && consorcio.nombre) || '-'} (${(consorcio && consorcio.direccion) || '-'})`);
  lineas.push(`Servicio: ${exp.tipoServicio || '-'} — ${exp.areaInstalacion || '-'}`);
  lineas.push(`Tipo: mantenimiento ${exp.tipoMantenimiento}`);
  lineas.push(`Proveedor adjudicado: ${prov.proveedorNombre || '-'} (CUIT ${prov.proveedorCuit || '-'})`);
  lineas.push(`Monto: ${fmtMoneda(prov.monto)}`);
  lineas.push(`Instrumentación: ${exp.instrumentacion.tipo === TIPO_INSTRUMENTACION.CONTRATO ? 'Contrato de locación' : 'Presupuesto aprobado'}`);
  lineas.push(`Visto bueno contratación: ${exp.vistoBuenoContratacion.aprobado ? 'APROBADO el ' + fmtFecha(exp.vistoBuenoContratacion.fecha) + ' por ' + exp.vistoBuenoContratacion.por : 'Pendiente'}`);
  lineas.push(`Visto bueno de pago: ${exp.vistoBuenoPago.aprobado ? 'APROBADO el ' + fmtFecha(exp.vistoBuenoPago.fecha) + ' por ' + exp.vistoBuenoPago.por : 'Pendiente'}`);
  if (exp.pago) {
    lineas.push(`Retenciones: SUSS ${exp.pago.aplicaSUSS ? fmtMoneda(exp.pago.montoRetSUSS) : 'No aplica'} · AGIP ${exp.pago.aplicaAGIP ? fmtMoneda(exp.pago.montoRetAGIP) : 'No aplica'}`);
    lineas.push(`Medio de pago: ${exp.pago.medioPago || '-'}`);
    lineas.push(`Monto a pagar (neto de retenciones): ${fmtMoneda(exp.pago.montoAPagar)}`);
  }
  return lineas.join('\n');
}

function copiarAlPortapapeles(texto, btn) {
  navigator.clipboard.writeText(texto).then(() => {
    if (btn) {
      const original = btn.textContent;
      btn.textContent = '✓ Copiado';
      btn.classList.add('btn-success-flash');
      setTimeout(() => { btn.textContent = original; btn.classList.remove('btn-success-flash'); }, 1600);
    }
  });
}

function abrirImprimible(titulo, textoPlano) {
  const w = window.open('', '_blank');
  const htmlEscapado = textoPlano.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${titulo}</title>
  <style>
    body { font-family: 'Georgia', serif; max-width: 780px; margin: 40px auto; color: #1a1a1a; line-height: 1.6; white-space: pre-wrap; }
    h1 { font-size: 18px; border-bottom: 2px solid #0B2A4A; padding-bottom: 8px; }
    .toolbar { text-align: right; margin-bottom: 20px; }
    .toolbar button { background: #0B2A4A; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
    @media print { .toolbar { display: none; } }
  </style></head><body>
  <div class="toolbar"><button onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button></div>
  <h1>${titulo}</h1>
  <div>${htmlEscapado}</div>
  </body></html>`);
  w.document.close();
}
