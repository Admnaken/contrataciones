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

### Publicar en GitHub Pages

1. Subir esta carpeta a un repositorio de GitHub (puede ser privado).
2. En **Settings → Pages**, elegir la rama y la carpeta raíz (`/`).
3. GitHub va a publicar la app en `https://<usuario>.github.io/<repo>/`. Si se quiere un subdominio propio (ej. `contrataciones.administracionnaken.com.ar`), se configura como CNAME en el proveedor de DNS, igual que se hizo con Balance Cero.

### Clave de acceso

La pantalla de ingreso es un **filtro, no una protección real** (si el repositorio es público, el código es visible para cualquiera). Sirve para que nadie que entre al link vea los datos sin clave.

- Clave por defecto: `Contratar#NK26`
- Para cambiarla: abrir la consola del navegador (F12) en la pantalla de acceso y ejecutar:
  ```js
  await hashClave("MiNuevaClave")
  ```
  Copiar el resultado y reemplazar el valor de `AUTH_HASH_DEFAULT` en `js/auth-gate.js`.
- Si se necesita protección real (que ni siquiera se pueda ver el código sin autenticarse), la mejora recomendada es poner **Cloudflare Access** delante del sitio, igual que se evaluó para Balance Cero.

## Estructura de archivos

```
index.html          → shell de la app + pantalla de acceso
css/styles.css       → estilos (paleta navy/dorado de Administración NAKEN)
js/data.js            → modelo de datos y checklists legales (editable si cambia la normativa)
js/templates.js       → generadores de email, contrato y resumen de expediente
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
- No tiene integración con "Mis Expensas" ni con el backend de la app principal de NAKEN Consorcios; es un módulo independiente pensado para llevar el expediente de contratación antes de que el gasto se vuelque a expensas.

## Próximas mejoras posibles

- Exportar/backup de expedientes a Google Drive (mismo patrón que Balance Cero).
- Adjuntar el presupuesto en PDF directamente al Acta/Resumen imprimible.
- Cloudflare Access delante del sitio para autenticación real.
- Integrar el resumen final como un ítem más del checklist de "Cierre y Traspaso" o de la liquidación de expensas de la app principal.
