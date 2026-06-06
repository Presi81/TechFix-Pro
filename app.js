/* ==========================================================================
   1. CONFIGURACIÓN E INICIALIZACIÓN DE CLIENTES (Capa de Datos)
   ========================================================================== */

// Leemos directamente lo que inyecta el entorno seguro de Vercel
const SUPABASE_URL = window.env?.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.env?.SUPABASE_ANON_KEY || '';
const GEMINI_API_KEY = window.env?.GEMINI_API_KEY || '';

// Inicializamos el cliente global de Supabase de manera segura
let supabaseClient = null;

try {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
        console.warn("Atención: Las llaves de Supabase están vacías. Configúralas en el panel de Vercel.");
    }
} catch (err) {
    console.error("Error crítico al inicializar el SDK de Supabase:", err);
}

// Variable global para almacenar el ID del equipo que se está editando (null si es una nueva orden)
let idEdicionActual = null;

/* ==========================================================================
   2. MAPEADO DEL DOM (Selectores de la Interfaz)
   ========================================================================== */
// Elementos del Formulario
const repairForm = document.getElementById('repairForm');
const btnIA = document.getElementById('btnIA');
const iaOutput = document.getElementById('iaOutput');

// Elementos de la Lista y Buscador
const listaReparaciones = document.getElementById('listaReparaciones');
const buscador = document.getElementById('buscador');


/* ==========================================================================
   3. FUNCIONES DE LÓGICA DE NEGOCIO (Controladores)
   ========================================================================== */

/**
 * CONTROLADOR A: Registra una nueva orden o actualiza una existente en Supabase
 * @param {Event} e - Evento de submit del formulario
 */
async function registrarReparacion(e) {
    e.preventDefault();

    // 1. Captura y limpieza de valores (Trim)
    const cliente = document.getElementById('cliente').value.trim();
    const telefono = document.getElementById('telefono').value.trim();
    const modelo = document.getElementById('modelo').value.trim();
    const nserie = document.getElementById('nserie').value.trim().toUpperCase();
    const fallo = document.getElementById('fallo').value.trim();
    const diagnostico = document.getElementById('diagnostico').value.trim();
    const coste = parseFloat(document.getElementById('coste').value) || 0;
    const total = parseFloat(document.getElementById('total').value) || 0;

    // 2. Batería de Validaciones estrictas de Negocio
    // Validación de Teléfono (Formato estándar español de 9 dígitos)
    const regexTelefono = /^[6789]\d{8}$/;
    if (!regexTelefono.test(telefono)) {
        mostrarNotificacion('⚠️ El número de teléfono debe tener 9 dígitos y empezar por 6, 7, 8 o 9.', 'error');
        return;
    }

    // Validación de importes coherentes
    if (coste < 0 || total < 0) {
        mostrarNotificacion('⚠️ Los precios y costes no pueden ser valores negativos.', 'error');
        return;
    }

    if (coste > total && total > 0) {
        mostrarNotificacion('⚠️ Alerta: El coste del repuesto es mayor que el precio final cobrado al cliente.', 'warning');
    }

    // Si pasa las validaciones, construimos el payload para la BD
    const datosReparacion = {
        cliente_nombre: cliente,
        cliente_tel: telefono,
        equipo: modelo,
        serie: nserie,
        sintomas: fallo,
        diagnostico: diagnostico,
        coste_piezas: coste,
        precio_total: total
    };

    try {
        if (idEdicionActual) {
            const { error } = await supabaseClient
                .from('reparaciones')
                .update(datosReparacion)
                .eq('id', idEdicionActual);

            if (error) throw error;
            mostrarNotificacion(`✅ Orden #${idEdicionActual} modificada correctamente.`, 'success');
            
            idEdicionActual = null;
            const btnGuardar = repairForm.querySelector('button[type="submit"]');
            btnGuardar.innerText = '💾 Registrar en Base de Datos';
            btnGuardar.style.backgroundColor = ''; 
        } else {
            datosReparacion.estado = 'Pendiente';
            const { error } = await supabaseClient
                .from('reparaciones')
                .insert([datosReparacion]);

            if (error) throw error;
            mostrarNotificacion('✅ Orden de reparación registrada con éxito.', 'success');
        }

        repairForm.reset();
        iaOutput.classList.add('hidden');
        cargarReparaciones();
        
    } catch (error) {
        console.error('Error en la operación:', error);
        mostrarNotificacion('❌ Error de base de datos: ' + error.message, 'error');
    }
}

/**
 * CONTROLADOR B: Lee los registros de Supabase y gestiona la respuesta
 */
async function cargarReparaciones() {
    try {
        const { data, error } = await supabaseClient
            .from('reparaciones')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // CALCULO AUTOMÁTICO: Disparamos el cálculo de estadísticas con los datos frescos
        calcularEstadisticas(data);

        renderizarLista(data);
        
    } catch (error) {
        console.error('Error al recuperar registros:', error);
        mostrarNotificacion('❌ Error de red al cargar el taller.', 'error');
    }
}

/**
 * CONTROLADOR C: Inyecta el código HTML dinámico en la lista con las opciones de control
 * @param {Array} reparaciones - Array de objetos provenientes de la BD
 */
function renderizarLista(reparaciones) {
    listaReparaciones.innerHTML = '';

    if (reparaciones.length === 0) {
        listaReparaciones.innerHTML = '<p class="no-data">No hay equipos en el taller.</p>';
        return;
    }

    reparaciones.forEach(rep => {
        const tarjeta = document.createElement('div');
        tarjeta.className = 'repair-card';
        
        const fechaLegible = new Date(rep.created_at).toLocaleDateString('es-ES');

        let badgeClass = 'badge-pendiente';
        if (rep.estado === 'En Curso') badgeClass = 'badge-reparando';
        if (rep.estado === 'Reparado') badgeClass = 'badge-listo';
        if (rep.estado === 'Entregado') badgeClass = 'badge-entregado';

        const notasHistorial = rep.historial ? rep.historial.replace(/\n/g, '<br>') : '<em>Sin intervenciones registradas.</em>';

        tarjeta.innerHTML = `
            <div class="card-top">
                <span>#${rep.id} - ${rep.equipo}</span>
                <span class="status-badge ${badgeClass}">${rep.estado}</span>
            </div>
            <div class="card-body">
                <p><strong>Cliente:</strong> ${rep.cliente_nombre} (${rep.cliente_tel})</p>
                <p><strong>Síntomas:</strong> ${rep.sintomas}</p>
                ${rep.diagnostico ? `<p><strong>Diagnóstico Inicial:</strong> ${rep.diagnostico}</p>` : ''}
            </div>
            
            <div class="history-box">
                <strong class="history-title">🛠️ Historial de Trabajo en Taller:</strong>
                <div class="history-content">
                    ${notasHistorial}
                </div>
            </div>

            <div class="card-metadata">
                Entrada: ${fechaLegible} | SN: ${rep.serie} | Presupuesto: ${rep.precio_total}€
            </div>

            <div class="note-input-group">
                <input 
                    type="text" 
                    id="nota-${rep.id}" 
                    placeholder="Añadir intervención (Ej: Flasheada BIOS...)" 
                    class="input-note"
                />
                <button 
                    onclick="añadirAnotacion('${rep.id}', \`${rep.historial || ''}\`)"
                    class="btn-note"
                >
                    + Nota
                </button>
            </div>

            <div class="status-selector-group">
                <label class="selector-label">Cambiar Estado:</label>
                <select class="select-status" onchange="cambiarEstado('${rep.id}', this.value)">
                    <option value="Pendiente" ${rep.estado === 'Pendiente' ? 'selected' : ''}>⏳ Pendiente</option>
                    <option value="En Curso" ${rep.estado === 'En Curso' ? 'selected' : ''}>👨‍💻 En Curso</option>
                    <option value="Reparado" ${rep.estado === 'Reparado' ? 'selected' : ''}>✅ Reparado</option>
                    <option value="Entregado" ${rep.estado === 'Entregado' ? 'selected' : ''}>📦 Entregado</option>
                </select>
            </div>

            <div class="action-buttons-group">
                <button 
                    onclick="imprimirAlbaranticket('${rep.id}')"
                    class="btn-print-data"
                >
                    🖨️ Imprimir Ticket
                </button>
                <button 
                    onclick="prepararEdicion('${rep.id}', \`${rep.cliente_nombre}\`, \`${rep.cliente_tel}\`, \`${rep.equipo}\`, \`${rep.serie}\`, \`${rep.sintomas}\`, \`${rep.diagnostico}\`, ${rep.coste_piezas}, ${rep.precio_total})"
                    class="btn-edit-data"
                >
                    ✏️ Editar
                </button>
                <button 
                    onclick="eliminarTicket('${rep.id}')"
                    class="btn-delete-data"
                >
                    🗑️ Eliminar
                </button>
            </div>
        `;
        
        listaReparaciones.appendChild(tarjeta);
    });
}

/**
 * CONTROLADOR D: Buscador Reactivo de Alta Fidelidad con Resaltado Dinámico
 */
function filtrarReparaciones(e) {
    const textoBusqueda = e.target.value.trim().toLowerCase();
    const tarjetas = document.querySelectorAll('.repair-card');

    tarjetas.forEach(tarjeta => {
        const cuerpoTarjeta = tarjeta.querySelector('.card-body');
        const metaTarjeta = tarjeta.querySelector('.card-metadata');
        const textoCompleto = tarjeta.textContent.toLowerCase();

        if (textoCompleto.includes(textoBusqueda)) {
            tarjeta.style.display = 'flex';
            
            if (textoBusqueda !== '') {
                resaltarTextoEnNodo(cuerpoTarjeta, textoBusqueda);
                resaltarTextoEnNodo(metaTarjeta, textoBusqueda);
            } else {
                limpiarResaltado(tarjeta);
            }
        } else {
            tarjeta.style.display = 'none';
            limpiarResaltado(tarjeta);
        }
    });
}

// Funciones auxiliares de bajo nivel para manipulación del DOM sin destruir eventos
function resaltarTextoEnNodo(nodo, busqueda) {
    if (!nodo) return;
    const regex = new RegExp(`(${busqueda})`, 'gi');
    let htmlLimpio = nodo.innerHTML.replace(/<mark class="highlight">|<\/mark>/g, '');
    nodo.innerHTML = htmlLimpio.replace(regex, '<mark class="highlight">$1</mark>');
}

function limpiarResaltado(tarjeta) {
    const cuerpo = tarjeta.querySelector('.card-body');
    const meta = tarjeta.querySelector('.card-metadata');
    if (cuerpo) cuerpo.innerHTML = cuerpo.innerHTML.replace(/<mark class="highlight">|<\/mark>/g, '');
    if (meta) meta.innerHTML = meta.innerHTML.replace(/<mark class="highlight">|<\/mark>/g, '');
}

/**
 * CONTROLADOR E: Conexión con la IA (Google Gemini 2.5 Flash API a través del endpoint v1beta)
 */
async function generarPrediagnostico() {
    const sintomas = document.getElementById('fallo').value.trim();

    if (!sintomas) {
        mostrarNotificacion('⚠️ Por favor, describe primero los síntomas o avería del equipo.', 'warning');
        return;
    }

    btnIA.innerText = '🤖 Analizando síntomas...';
    btnIA.disabled = true;
    iaOutput.classList.remove('hidden');
    iaOutput.innerHTML = '<em>Conectando con el núcleo de IA... Analizando componentes habituales...</em>';

    const promptInstrucciones = `Actúa como un Ingeniero Técnico Senior de soporte de hardware en un taller de reparaciones microelectrónicas. 
    Te adjunto los síntomas de un equipo que acaba de entrar al taller: "${sintomas}". 
    Por favor, genera un prediagnóstico rápido, directo y structured en texto plano (máximo 4 líneas) indicando:
    1. Posibles componentes afectados.
    2. Mediciones preliminares sugeridas en la placa o equipo.
    Sé conciso y técnico.`;

    try {
        const respuesta = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: promptInstrucciones }]
                }]
            })
        });

        if (!respuesta.ok) throw new Error('Error en la respuesta del servidor de IA');

        const datosJSON = await respuesta.json();
        const textoIA = datosJSON.candidates[0].content.parts[0].text;

        iaOutput.innerHTML = `<strong>Sugerencia de la IA:</strong><br>${textoIA.replace(/\n/g, '<br>')}`;
        document.getElementById('diagnostico').value = `[Sugerencia IA]: ${textoIA}`;
        
        mostrarNotificacion('🤖 Prediagnóstico por IA generado correctamente.', 'success');

    } catch (error) {
        console.error('Error de IA:', error);
        iaOutput.innerHTML = '❌ No se ha podido generar el prediagnóstico. Revisa la consola o tu API Key.';
        mostrarNotificacion('❌ Error de conexión con el servidor de Inteligencia Artificial.', 'error');
    } finally {
        btnIA.innerText = '🤖 Generar Prediagnóstico con IA';
        btnIA.disabled = false;
    }
}

/**
 * CONTROLADOR F: Actualización rápida de Estado (Supabase UPDATE)
 */
async function cambiarEstado(idEquipo, nuevoEstado) {
    try {
        const { error } = await supabaseClient
            .from('reparaciones')
            .update({ estado: nuevoEstado })
            .eq('id', idEquipo);

        if (error) throw error;
        
        console.log(`[Database] Orden #${idEquipo} actualizada a: ${nuevoEstado}`);
        mostrarNotificacion(`💼 Orden #${idEquipo} cambiada a [${nuevoEstado}].`, 'success');
        cargarReparaciones();

    } catch (error) {
        console.error('Error al actualizar el estado:', error);
        mostrarNotificacion('❌ Error de red: No se pudo actualizar el estado en la base de datos.', 'error');
    }
}

/**
 * CONTROLADOR G: Registro de Bitácora Técnica (Append a Historial)
 */
async function añadirAnotacion(idEquipo, historialPrevio) {
    const inputNota = document.getElementById(`nota-${idEquipo}`);
    const textoNota = inputNota.value.trim();

    if (!textoNota) {
        mostrarNotificacion('⚠️ Escribe primero la anotación que deseas registrar en el historial.', 'warning');
        return;
    }

    const ahora = new Date();
    const marcaTiempo = `[${ahora.toLocaleDateString('es-ES')} ${ahora.toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'})}]`;
    
    const nuevaLinea = `${marcaTiempo} ${textoNota}`;
    const historialActualizado = historialPrevio ? `${historialPrevio}\n${nuevaLinea}` : nuevaLinea;

    try {
        const { error } = await supabaseClient
            .from('reparaciones')
            .update({ historial: historialActualizado })
            .eq('id', idEquipo);

        if (error) throw error;
        
        console.log(`[SAT] Nota añadida al equipo #${idEquipo}`);
        mostrarNotificacion(`📝 Nota añadida a la bitácora de la Orden #${idEquipo}.`, 'success');
        cargarReparaciones();

    } catch (error) {
        console.error('Error al guardar la nota:', error);
        mostrarNotificacion('❌ No se pudo guardar la anotación técnica en el servidor.', 'error');
    }
}

/**
 * CONTROLADOR H: Carga los datos de la tarjeta de vuelta en el formulario para editar
 */
function prepararEdicion(id, cliente, tel, equipo, serie, sintomas, diagnostico, coste, total) {
    idEdicionActual = id;

    document.getElementById('cliente').value = cliente;
    document.getElementById('telefono').value = tel;
    document.getElementById('modelo').value = equipo;
    document.getElementById('nserie').value = serie;
    document.getElementById('fallo').value = sintomas;
    document.getElementById('diagnostico').value = diagnostico;
    document.getElementById('coste').value = coste;
    document.getElementById('total').value = total;

    const btnGuardar = repairForm.querySelector('button[type="submit"]');
    btnGuardar.innerText = `🔄 Actualizar Orden #${id}`;
    btnGuardar.style.backgroundColor = '#059669'; 

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * CONTROLADOR I: Elimina permanentemente un registro de Supabase
 */
async function eliminarTicket(idEquipo) {
    const confirmar = confirm(`⚠️ ¿Estás seguro de que deseas ELIMINAR por completo la Orden #${idEquipo}? Esta acción es irreversible.`);
    if (!confirmar) return;

    try {
        const { error } = await supabaseClient
            .from('reparaciones')
            .delete()
            .eq('id', idEquipo);

        if (error) throw error;
        
        console.log(`[Database] Orden #${idEquipo} eliminada.`);
        mostrarNotificacion(`🗑️ Orden #${idEquipo} eliminada permanentemente del sistema.`, 'warning');
        cargarReparaciones();

    } catch (error) {
        console.error('Error al eliminar:', error);
        mostrarNotificacion('❌ Error: No se ha podido eliminar el registro de la base de datos.', 'error');
    }
}

/**
 * CONTROLADOR J: Métricas y Cuadro de Mandos en Tiempo Real
 */
function calcularEstadisticas(reparaciones) {
    const total = reparaciones.length;
    
    const pendientes = reparaciones.filter(rep => rep.estado === 'Pendiente').length;
    const enCurso = reparaciones.filter(rep => rep.estado === 'En Curso').length;
    
    const caja = reparaciones
        .filter(rep => rep.estado === 'Reparado' || rep.estado === 'Entregado')
        .reduce((acumulado, rep) => acumulado + (rep.precio_total || 0), 0);

    document.getElementById('statTotal').innerText = total;
    document.getElementById('statPendientes').innerText = pendientes;
    document.getElementById('statEnCurso').innerText = enCurso;
    document.getElementById('statCaja').innerText = `${caja.toFixed(2)}€`;
}

/**
 * CONTROLADOR K: Sistema de Aislamiento de Impresión Nativa (Albaranes de Cliente)
 */
function imprimirAlbaranticket(idEquipo) {
    const tarjetas = document.querySelectorAll('.repair-card');
    
    document.body.classList.add('modo-impresion-aislada');
    
    tarjetas.forEach(tarjeta => {
        if (tarjeta.innerHTML.includes(`#${idEquipo}`)) {
            tarjeta.classList.add('tarjeta-activa-print');
        } else {
            tarjeta.classList.remove('tarjeta-activa-print');
        }
    });

    window.print();

    document.body.classList.remove('modo-impresion-aislada');
    tarjetas.forEach(tarjeta => tarjeta.classList.remove('tarjeta-activa-print'));
}

/**
 * SUBSISTEMA L: Banners de Notificaciones Flotantes (UI Toasts)
 */
function mostrarNotificacion(mensaje, tipo = 'success') {
    const container = document.getElementById('notification-container');
    
    const toast = document.createElement('div');
    toast.className = `toast-card toast-${tipo}`;
    toast.innerText = mensaje;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}


/* ==========================================================================
   4. ESCUCHADORES DE EVENTOS (Event Listeners)
   ========================================================================== */
// Procesar el envío del formulario (Guarda nuevos o edita existentes)
repairForm.addEventListener('submit', registrarReparacion);

// Filtrado del buscador en tiempo real
buscador.addEventListener('input', filtrarReparaciones);

// Llamada cognitiva a Gemini
btnIA.addEventListener('click', generarPrediagnostico);

// Carga inicial al inicializar el DOM
document.addEventListener('DOMContentLoaded', cargarReparaciones);