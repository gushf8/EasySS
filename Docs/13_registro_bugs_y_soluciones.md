# Registro de Bugs Identificados y Soluciones Implementadas - EasySS

Este documento detalla los problemas técnicos detectados durante el desarrollo y las optimizaciones aplicadas para garantizar una experiencia de usuario fluida y libre de errores.

---

## 1. El Problema de las "Imágenes Zombie" (Sincronización Infinita)

### **Descripción del Bug**
El usuario borraba una imagen del historial (usando la "X"), pero al refrescar la interfaz o volver a abrir la extensión, la imagen reaparecía automáticamente.

### **Causa Raíz**
La extensión cuenta con un motor de sincronización automática que lee el portapapeles. Si la imagen borrada sigue siendo el contenido activo en el portapapeles de Windows, el sistema la detectaba como una "nueva captura" y la volvía a insertar en la base de datos IndexedDB en cada ciclo de refresco.

### **Solución Implementada**
1.  **Blacklist Persistente**: Se creó un sistema de lista negra almacenada en `chrome.storage.local`.
2.  **Huella Digital (Hashing)**: Al borrar una imagen, se genera un hash SHA-1 del archivo y se guarda en la lista negra.
3.  **Filtro de Entrada**: El motor de sincronización ahora consulta esta lista antes de procesar cualquier imagen. Si el hash está bloqueado, la imagen se ignora.
4.  **Desbloqueo Manual**: Si el usuario pega la imagen explícitamente (`Ctrl + V`), se elimina de la lista negra, permitiendo su recuperación voluntaria.

---

## 2. Toasts de Confirmación Falsos Positivos

### **Descripción del Bug**
Cada vez que el usuario abría el selector (Ctrl + Shift), aparecía el mensaje "Imagen capturada con éxito", incluso si no había nada nuevo.

### **Causa Raíz**
La función de captura no discriminaba entre imágenes nuevas y existentes. Al encontrar una imagen en el portapapeles, lanzaba la notificación de éxito independientemente de si ya estaba en el historial.

### **Solución Implementada**
Se modificó la lógica de `addImageToDB` para devolver un flag `isNew`. Ahora, la notificación solo se dispara si la imagen no existía previamente en la base de datos, evitando ruido visual innecesario.

---

## 3. Limitación Crítica de Historial

### **Descripción del Bug**
El historial de descargas e imágenes estaba limitado a 8 o 20 elementos, lo que impedía al usuario recuperar archivos de días anteriores.

### **Causa Raíz**
Valores de `limit` y `.slice()` muy bajos en el código de `background.js` y `modal.js`.

### **Solución Implementada**
Se aumentó la capacidad a **100 elementos** en todos los niveles:
-   Búsqueda en la API de descargas de Chrome.
-   Renderizado de cuadrículas en la UI.
-   Lista lateral de documentos.

---

## 4. Ineficiencia de Espacio en Tarjetas de Documentos

### **Descripción del Bug**
Los botones de "Copiar" y "Eliminar" ocupaban espacio fijo a la derecha, lo que causaba que los nombres de archivo largos se cortaran casi a la mitad.

### **Causa Raíz**
Layout basado en `flexbox` con elementos estáticos que competían por el ancho de la tarjeta.

### **Solución Implementada**
1.  **Botones Flotantes**: Se movieron los botones a una capa superior (`position: absolute`) que solo aparece al pasar el cursor.
2.  **Animación Marquee**: Se implementó una animación CSS que desplaza el texto horizontalmente en bucle cuando el usuario pone el ratón encima, permitiendo leer nombres de archivo infinitamente largos.

---

## 5. Falta de Localización de Archivos Físicos

### **Descripción del Bug**
El usuario podía ver que un archivo fue descargado, pero no recordaba en qué subcarpeta de su PC estaba guardado.

### **Causa Raíz**
Inexistencia de una función para interactuar con el sistema de archivos del SO.

### **Solución Implementada**
Se añadió un botón de **"Abrir ubicación"** (Icono de Carpeta) que utiliza la API `chrome.downloads.show()`. Esto abre el explorador de archivos nativo de Windows/Mac y resalta automáticamente el archivo seleccionado.

---

## 6. Papelera de Reciclaje y Recuperación de Datos

### **Descripción del Bug**
El borrado de imágenes era definitivo e instantáneo. Si el usuario se equivocaba, no había forma de recuperar la captura sin volver a buscarla en la web de origen.

### **Solución Implementada**
1.  **Soft Delete**: Ahora el botón borrar no elimina el registro, sino que lo marca como `deleted: true`.
2.  **Módulo de Papelera**: Se añadió una nueva interfaz de papelera donde se almacenan estos elementos.
3.  **Restauración**: Se incluyó un botón de restaurar que devuelve la imagen al historial activo y limpia su estado en la lista negra.

---

> [!NOTE]
> Todas estas soluciones han sido probadas en entornos de alto tráfico de portapapeles (como Facebook y WhatsApp) para asegurar que la extensión sea robusta y predecible.
