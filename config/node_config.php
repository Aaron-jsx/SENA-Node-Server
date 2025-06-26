<?php
/**
 * Configuración del servidor Node.js para llamadas virtuales
 * Este archivo centraliza la configuración del servidor Node.js
 */

// URL del servidor Node.js en Render
// Cambiar esta URL cuando se suba el servidor Node.js a producción
define('NODE_SERVER_URL', 'https://tuserver.onrender.com');

// Endpoints del servidor Node.js
define('NODE_ENDPOINT_LLAMAR', NODE_SERVER_URL . '/llamar');
define('NODE_ENDPOINT_HEALTH', NODE_SERVER_URL . '/health');

// Configuración de timeout para las llamadas HTTP
define('NODE_TIMEOUT', 10); // segundos

// Configuración de reintentos
define('NODE_MAX_RETRIES', 3);
define('NODE_RETRY_DELAY', 2); // segundos

// Configuración de logging
define('NODE_LOG_ENABLED', true);
define('NODE_LOG_FILE', __DIR__ . '/../logs/node_integration.log');

/**
 * Obtener la URL completa del endpoint de llamadas
 * 
 * @return string URL completa del endpoint
 */
function getNodeCallEndpoint() {
    return NODE_ENDPOINT_LLAMAR;
}

/**
 * Obtener la URL completa del endpoint de health check
 * 
 * @return string URL completa del endpoint
 */
function getNodeHealthEndpoint() {
    return NODE_ENDPOINT_HEALTH;
}

/**
 * Log de eventos de integración con Node.js
 * 
 * @param string $message Mensaje a loguear
 * @param string $level Nivel de log (info, warning, error)
 * @return void
 */
function logNodeEvent($message, $level = 'info') {
    if (!NODE_LOG_ENABLED) {
        return;
    }
    
    $log_dir = dirname(NODE_LOG_FILE);
    if (!is_dir($log_dir)) {
        mkdir($log_dir, 0755, true);
    }
    
    $timestamp = date('Y-m-d H:i:s');
    $log_entry = "[$timestamp] [$level] $message" . PHP_EOL;
    
    file_put_contents(NODE_LOG_FILE, $log_entry, FILE_APPEND | LOCK_EX);
}

/**
 * Verificar si la integración con Node.js está habilitada
 * 
 * @return bool True si está habilitada
 */
function isNodeIntegrationEnabled() {
    return defined('NODE_SERVER_URL') && !empty(NODE_SERVER_URL);
}
?> 