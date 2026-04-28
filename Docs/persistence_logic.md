# Lógica de Persistencia y Transferencia de Datos

Este documento explica técnicamente cómo **EasySS** logra mantener un historial de capturas de pantalla y cómo transfiere esos datos de forma segura entre la extensión y los sitios web.

## 1. El "Cerebro" de la Memoria: IndexedDB

EasySS utiliza **IndexedDB** para almacenar las capturas. A diferencia de `localStorage`, que tiene un límite de 5MB, IndexedDB permite almacenar grandes cantidades de datos binarios (Blobs) de forma eficiente.

### ¿Por qué es seguro?
- **Sandbox del Navegador**: IndexedDB está sujeto a la política de mismo origen (*Same-Origin Policy*). La base de datos de la extensión solo es accesible por los scripts de la extensión.
- **Privacidad**: Ninguna página web (como WhatsApp o Facebook) puede "ver" o consultar la base de datos de EasySS. Tus capturas están aisladas en un entorno seguro.
- **Local Primero**: Los datos nunca salen de tu computadora hacia nuestros servidores. Todo el procesamiento y almacenamiento es local.

## 2. Sistema de Respaldo Manual (Eternidad)

Dado que Chrome elimina todos los datos de una extensión al desinstalarla, se ha implementado un sistema de **Importación/Exportación**:
- **Exportar (.easyss)**: Serializa todo el historial de IndexedDB (incluyendo blobs convertidos a Base64) en un solo archivo JSON.
- **Importar**: Permite restaurar el historial completo en una nueva instalación simplemente seleccionando el archivo de respaldo.
- **Almacenamiento en Disco**: Este método garantiza que el usuario tenga el control físico de sus capturas fuera del entorno limitado del navegador.

## 3. Transferencia de Datos sin Restricciones (CSP Bypass)

Las políticas de seguridad de contenido (CSP) de sitios como GitHub o WhatsApp a menudo bloquean la carga de imágenes desde URLs externas o incluso desde `blob:` URLs generadas dinámicamente.

### ¿Cómo lo solucionamos?
1. **Conversión a DataURL**: Cuando eliges una imagen del historial, la convertimos en una cadena de texto Base64 (`DataURL`).
2. **Mensajería Segura (`postMessage`)**: Enviamos esa cadena de texto desde el IFrame de la extensión hacia el script inyectado en la página (`content.js`). Los navegadores permiten este paso de mensajes como una forma segura de comunicación entre contextos.
3. **Reconstrucción Manual**: En lugar de usar un `fetch()` (que el CSP bloquearía), reconstruimos el archivo binario en la memoria de `content.js` usando un `Uint8Array`.
4. **Inyección por DataTransfer**: Usamos la API `DataTransfer` para insertar el archivo en el campo de subida del sitio web, emulando exactamente lo que sucede cuando arrastras un archivo desde tu carpeta de Windows.

## 3. Flujo Técnico del Dato

1. **Captura / Pegado**: La imagen entra al modal de la extensión.
2. **Almacenamiento**: Se guarda el `Blob` en IndexedDB.
3. **Selección**: El usuario hace clic en una miniatura.
4. **Codificación**: El `Blob` se convierte a `DataURL` (Base64).
5. **Transporte**: Se envía al script de contenido vía `postMessage`.
6. **Decodificación**: El script de contenido convierte el Base64 en un `File` real.
7. **Inyección**: Se asigna al `input.files` y se dispara el evento `change`.

## 4. Beneficios de esta Arquitectura
- **Velocidad**: El acceso a IndexedDB es casi instantáneo.
- **Robustez**: Funciona en sitios con las políticas de seguridad más estrictas del mundo.
- **Persistencia**: Tus capturas permanecen allí incluso si reinicias el navegador o limpias la caché de los sitios web.
