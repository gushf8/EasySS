# ⚡ EasySS Image Upload - Chrome Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Sube capturas de pantalla e imágenes de tu portapapeles a cualquier web al instante, sin guardarlas en tu disco ni buscarlas manualmente.**

Inspirado en la funcionalidad *Easy Files* de Opera, **EasySS** intercepta automáticamente los selectores de subida de archivos en la web o te permite activarlo con un atajo, presentándote un modal flotante moderno con tus capturas recientes y portapapeles listo para usar con un solo clic.

---

## 🚀 Guía de Instalación Rápida (Paso a Paso)

Sigue estos sencillos pasos para instalar y usar la extensión en **Google Chrome, Microsoft Edge, Brave, Opera** o cualquier navegador basado en Chromium:

### Paso 1: Descargar el proyecto
1. Haz clic en el botón verde **`Code`** arriba a la derecha en GitHub.
2. Selecciona **`Download ZIP`** (o clona el repositorio con `git clone`).
3. Descomprime el archivo `.zip` en una carpeta permanente de tu computadora (por ejemplo, en tu carpeta de *Documentos* o *Programas*).

---

### Paso 2: Activar el Modo Desarrollador en el navegador
1. Abre tu navegador y escribe en la barra de direcciones:
   - En **Google Chrome**: `chrome://extensions`
   - En **Microsoft Edge**: `edge://extensions`
   - En **Brave**: `brave://extensions`
   - En **Opera**: `opera://extensions`
2. En la esquina superior derecha, activa la casilla o interruptor **"Modo de desarrollador"** (*Developer mode*).

---

### Paso 3: Cargar la extensión
1. Haz clic en el botón **"Cargar descomprimida"** (*Load unpacked*) que aparece en la barra superior.
2. Selecciona la carpeta donde descomprimiste el proyecto (la carpeta principal que contiene el archivo `manifest.json`).
3. ¡Listo! Verás la tarjeta de **EasySS Image Upload** activada y disponible.

> 💡 **Consejo:** Fija el ícono de EasySS en tu barra de extensiones haciendo clic en el ícono del rompecabezas (🧩) de Chrome y luego en la chincheta (📌).

---

## ✨ Características Principales

- 📸 **Detección Automática de Capturas:** Detecta tus capturas tomadas con `Win + Shift + S` (o Cmd+Shift+4 en Mac).
- 📋 **Integración de Portapapeles:** Acceso inmediato a la última imagen copiada y soporte para pegar directo con `Ctrl + V` dentro del selector.
- 🎯 **Interceptación Inteligente:** Al hacer clic en "Subir archivo" o "Seleccionar imagen" en cualquier sitio web (Discord, WhatsApp Web, Slack, Imgur, Canva, etc.), EasySS te muestra tus imágenes recientes en lugar del explorador de archivos tradicional.
- ⌨️ **Atajo Global:** Presiona `Ctrl + Shift + S` (`Cmd + Shift + S` en Mac) para invocar el selector en cualquier momento.
- 🔒 **100% Privado y Local:** Tus imágenes se procesan de forma local en tu navegador mediante IndexedDB. Cero telemetría, cero servidores externos, máxima velocidad.
- 🎨 **Diseño Moderno:** Interfaz ultra fluida con glassmorphism, modo oscuro y animaciones sutiles.

---

## ⌨️ Atajos y Uso

| Acción | Atajo / Método |
| :--- | :--- |
| **Abrir Selector Manualmente** | `Ctrl + Shift + S` (Mac: `Cmd + Shift + S`) |
| **Pegar Imagen Directa** | `Ctrl + V` (con el selector abierto) |
| **Cerrar Selector** | Tecla `Esc` o clic fuera del modal |
| **Abrir Explorador Clásico de Windows** | Clic en el botón "Explorador de archivos" dentro del modal |

---

## 🛠️ Actualizaciones y Mantenimiento

Si descargas una versión actualizada del repositorio o modificas el código:
1. Ve a `chrome://extensions`.
2. Busca la tarjeta de **EasySS Image Upload**.
3. Haz clic en el ícono de **recargar** (🔄 flecha circular).

---

## 📁 Estructura del Proyecto

```text
├── manifest.json            # Configuración de la extensión (Manifest V3)
├── background.js           # Service worker en segundo plano
├── content.js              # Script de contenido para interceptación en páginas
├── main_world.js           # Inyección en el contexto principal de la página
├── modal.html / .css / .js # Interfaz gráfica del selector de capturas
├── popup.html / .css / .js # Menú emergente de opciones y ajustes
├── offscreen.html / .js    # Documento offscreen para manejo seguro del portapapeles
└── icons/                  # Íconos de la extensión
```

---

## 📄 Licencia y Privacidad
Este proyecto está bajo la Licencia **MIT** - consulta el archivo [LICENSE](LICENSE) para más detalles.

🔒 **Privacidad:** Tus datos, capturas e imágenes nunca salen de tu ordenador ni se envían a ningún servidor externo.

