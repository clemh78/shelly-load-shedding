/******************************************************************************
 * PRO 3 SAFETY PROTECTION SCRIPT
 * Version: 1.2
 * Author: Clément
 *
 * Installation: Shelly Pro 3 → Settings → Scripts → Add Script
 * IP: 10.0.0.101
 *
 * 🛡️ PROTECTION: Emergency shutdown if Pro 3EM heartbeat is lost
 *
 * How it works:
 * - Pro 3 sends HTTP heartbeat to Pro 3EM every 10 seconds
 * - Pro 3EM sends HTTP heartbeat to Pro 3 every 10 seconds (bidirectional)
 * - If heartbeat fails → cut all relays (emergency shutdown)
 * - When heartbeat resumes → log recovery (Pro 3EM will restore relays)
 ******************************************************************************/

// ============================================================================
// CONFIGURATION
// ============================================================================

let CONFIG = {
  // Network addresses
  PRO3EM_IP: "10.0.0.100",          // Pro 3EM IP address

  // 🔒 SAFETY SETTINGS
  HEARTBEAT_INTERVAL: 10000,        // Send heartbeat every 10s
  MAX_CONSECUTIVE_FAILURES: 1,      // Mark offline after 1 failed heartbeat

  // Debug mode
  DEBUG: true,

  // Relay configuration
  RELAYS: [0, 1, 2]  // Pro 3 has 3 relays
};

// ============================================================================
// GLOBAL STATE
// ============================================================================

let state = {
  pro3emOnline: false,              // Is Pro 3EM online?
  consecutiveFailures: 0,           // Count of consecutive heartbeat failures
  emergencyShutdownActive: false    // Are we in emergency shutdown mode?
};

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
  log("Pro 3 Safety Protection initialized");
  log("Heartbeat interval: " + (CONFIG.HEARTBEAT_INTERVAL / 1000) + "s");
  log("Max consecutive failures: " + CONFIG.MAX_CONSECUTIVE_FAILURES);
  log("Monitoring " + CONFIG.RELAYS.length + " relays");
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(message) {
  if (CONFIG.DEBUG) {
    print("[PRO3-SAFETY] " + message);
  }
}

function logError(message) {
  print("[PRO3-SAFETY] ERROR: " + message);
}

function buildRpcUrl(method, params) {
  return "http://" + CONFIG.PRO3EM_IP + "/rpc/" + method + (params ? "?" + params : "");
}

// ============================================================================
// RELAY CONTROL
// ============================================================================

function cutRelay(relayId) {
  Shelly.call("Switch.Set", {id: relayId, on: false}, function(result, error_code, error_message) {
    if (error_code !== 0) {
      logError("Failed to cut relay " + relayId + ": " + error_message);
    } else {
      log("✂️ Relay " + relayId + " cut");
    }
  });
}

function emergencyShutdown() {
  if (state.emergencyShutdownActive) {
    return; // Already in emergency mode
  }

  state.emergencyShutdownActive = true;
  logError("🚨 EMERGENCY SHUTDOWN: Pro 3EM heartbeat lost - cutting all relays");

  // Turn off all relays
  for (let i = 0; i < CONFIG.RELAYS.length; i++) {
    cutRelay(CONFIG.RELAYS[i]);
  }
}

function cancelEmergencyShutdown() {
  if (!state.emergencyShutdownActive) {
    return;
  }

  state.emergencyShutdownActive = false;
  log("✅ Pro 3EM heartbeat restored - emergency mode cancelled");
  log("   (Relays will be restored by Pro 3EM load shedding logic)");
}

// ============================================================================
// HEARTBEAT MONITORING
// ============================================================================

function sendHeartbeat() {
  let wasOnline = state.pro3emOnline;
  let url = buildRpcUrl("Shelly.GetStatus", "");

  Shelly.call("HTTP.GET", {url: url}, function(_result, error_code, error_message) {
    if (error_code !== 0) {
      // Heartbeat failed = Pro 3EM is offline
      state.consecutiveFailures++;
      log("Heartbeat failed (" + state.consecutiveFailures + "/" + CONFIG.MAX_CONSECUTIVE_FAILURES + "): " + error_message);

      if (state.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES && wasOnline) {
        state.pro3emOnline = false;
        logError("💔 Pro 3EM is now OFFLINE");
        emergencyShutdown();
      }
    } else {
      // Heartbeat succeeded = Pro 3EM is online
      state.consecutiveFailures = 0;

      if (!wasOnline) {
        // Was offline, now online (reconnection or first connection at startup)
        state.pro3emOnline = true;
        log("💚 Pro 3EM is now ONLINE");
        cancelEmergencyShutdown();
      }
    }
  });
}

// ============================================================================
// STARTUP
// ============================================================================

init();

let header = "\n" +
             "==============================================\n" +
             "  PRO 3 SAFETY PROTECTION\n" +
             "==============================================\n" +
             "Pro 3EM IP: " + CONFIG.PRO3EM_IP + "\n" +
             "Heartbeat interval: " + (CONFIG.HEARTBEAT_INTERVAL / 1000) + "s\n" +
             "Max consecutive failures: " + CONFIG.MAX_CONSECUTIVE_FAILURES + "\n" +
             "==============================================\n";
print(header);

log("[OK] Safety protection active!");

// Start HTTP heartbeat to Pro 3EM
sendHeartbeat();  // Initial heartbeat
Timer.set(CONFIG.HEARTBEAT_INTERVAL, true, sendHeartbeat);
log("HTTP heartbeat monitoring started (every " + (CONFIG.HEARTBEAT_INTERVAL/1000) + "s)");
