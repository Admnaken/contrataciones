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

Desde octubre de 2026 los datos **no se guardan en el navegador**: viven en el servidor de la app principal de NAKEN (el mismo Google Apps Script), así que se ven desde cualquier equipo y no se pierden al borrar el historial del navegador. Se ingresa con el **usuario y la clave de administrador de la app principal**. Los PDF de presupuestos y facturas se guardan en el Drive de la administración, sin enlace público.

El servidor es el que hace cumplir las reglas importantes (no se pueden saltear desde el navegador):
- Después del Visto Bueno de contratación, el proveedor, el presupuesto y la documentación quedan fijos; después del Visto Bueno de pago, también la factura y las retenciones.
- Rechaza aprobar el pago de una factura (CUIT + punto de venta + número) que ya está en otro expediente.
- Cada expediente tiene número de versión: si se editó desde otro equipo, el segundo cambio no pisa al primero.
- El historial del expediente no se puede borrar; un expediente se puede anular con motivo, pero no eliminar.
- Cada Visto Bueno se anota solo en la hoja `Contrataciones_Historial` de la planilla del consorcio.

Si quedaron expedientes de la versión anterior guardados en un navegador, al entrar desde ese navegador el panel ofrece importarlos al servidor.

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

### Acceso

Usuario y clave de administrador de la app principal (los valida el servidor; no hay ninguna clave escrita en el código). "Recordarme en este dispositivo" mantiene la sesión hasta que vence (12 horas).

## Estructura de archivos

```
index.html          → shell de la app + pantalla de acceso
css/styles.css       → estilos (paleta navy/dorado de Administración NAKEN)
js/data.js            → modelo de datos y checklists legales (editable si cambia la normativa)
js/templates.js       → generadores de email, contrato y resumen de expediente
js/api.js            → comunicación con el servidor de la app principal
js/app.js             → lógica de la app, router y render de cada panel
js/auth-gate.js       → ingreso con usuario y clave de administrador
assets/logo.png       → logo de Administración NAKEN
```

## Mantenimiento de datos normativos

Algunos valores conviene revisarlos periódicamente porque la normativa o los importes de referencia cambian:

- `FERIADOS_MOVILES` en `js/data.js` — agregar cada año los feriados trasladables y puentes (los de fecha fija ya están).
- **Parámetros de retención** (menú "Retenciones" de la app): mínimo no sujeto de Ganancias (RG 830), alícuotas de SUSS, IIBB por defecto e IVA. Se guardan en el servidor; confirmarlos con el contador y actualizarlos cuando cambie la normativa. La app calcula una sugerencia (Ganancias acumulando lo pagado al mismo proveedor en el mes) que siempre se puede corregir a mano.
- Alícuota de IIBB (AGIP) de cada proveedor — se carga en la Fase 2 según el padrón vigente.

## Alcance y límites (a tener en cuenta)

- No reemplaza el asesoramiento de un contador o abogado: automatiza el *checklist* y la generación de documentos modelo, pero la validación real ante ARCA/AGIP/AGC se sigue haciendo en los sitios oficiales.
- No genera la carta documento de intimación ni representa a la administración ante un conflicto — eso, como en el resto del proyecto, queda para un profesional según el caso concreto.
- Comparte el servidor y los consorcios con la app principal: lee el historial de mantenimiento para avisar trabajos repetidos o en garantía, y deja cada Visto Bueno en `Contrataciones_Historial`. No carga gastos ni retenciones en `Gastos_Mensual`: eso lo sigue haciendo la app principal.

## Próximas mejoras posibles

- Adjuntar el presupuesto en PDF directamente al Acta/Resumen imprimible.
- Integrar el resumen final como un ítem más del checklist de "Cierre y Traspaso" o de la liquidación de expensas de la app principal.
