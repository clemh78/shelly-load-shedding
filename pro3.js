/******************************************************************************
 * PRO 3 SAFETY PROTECTION SCRIPT
 * Version: 1.0
 * Author: Clément
 *
 * Installation: Shelly Pro 3 → Settings → Scripts → Add Script
 * IP: 10.0.0.101
 *
 * 🛡️ PROTECTION: Emergency shutdown if Pro 3EM heartbeat is lost
 *
 * How it works:
 * - Pro 3EM sends heartbeats by writing to KVS key "pro3em_heartbeat"
 * - This script checks the heartbeat timestamp every 5 seconds
 * - If no heartbeat for HEARTBEAT_TIMEOUT → cut all relays
 * - When heartbeat resumes → log recovery (Pro 3EM will restore relays)
 ******************************************************************************/

// ============================================================================
// CONFIGURATION
// ============================================================================

let CONFIG = {
  // 🔒 SAFETY SETTINGS
  HEARTBEAT_TIMEOUT: 30000,         // Cut relays if no heartbeat for 30s
  HEARTBEAT_CHECK_INTERVAL: 5000,   // Check heartbeat every 5s

  // Debug mode
  DEBUG: true,

  // Relay configuration
  RELAYS: [0, 1, 2],  // Pro 3 has 3 relays

  // KVS key for heartbeat
  HEARTBEAT_KEY: "pro3em_heartbeat"
};

// ============================================================================
// GLOBAL STATE
// ============================================================================

let state = {
  lastHeartbeatTime: null,          // Last heartbeat timestamp from Pro 3EM
  pro3emOnline: false,              // Is Pro 3EM sending heartbeats?
  emergencyShutdownActive: false,   // Are we in emergency shutdown mode?
  startupTime: Date.now()           // Script startup time (grace period)
};

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
  log("Pro 3 Safety Protection initialized");
  log("Heartbeat timeout: " + (CONFIG.HEARTBEAT_TIMEOUT / 1000) + "s");
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

function checkHeartbeat() {
  // Read heartbeat timestamp from KVS
  Shelly.call("KVS.Get", {key: CONFIG.HEARTBEAT_KEY}, function(result, error_code, error_message) {
    let now = Date.now();

    // Grace period: don't trigger emergency during first 30 seconds after startup
    let gracePeriod = 30000;
    if (now - state.startupTime < gracePeriod) {
      log("Grace period active (" + Math.floor((gracePeriod - (now - state.startupTime)) / 1000) + "s remaining)");
      return;
    }

    if (error_code !== 0) {
      // KVS key doesn't exist or error reading
      if (error_code === -103) {
        // Key not found - Pro 3EM hasn't sent heartbeat yet
        if (state.pro3emOnline) {
          // Was online, now lost
          state.pro3emOnline = false;
          logError("💔 Pro 3EM heartbeat key not found");
          emergencyShutdown();
        }
      } else {
        logError("Failed to read heartbeat: " + error_message);
      }
      return;
    }

    // Parse heartbeat timestamp
    let heartbeatValue = result.value;
    if (typeof heartbeatValue !== "number") {
      logError("Invalid heartbeat value: " + heartbeatValue);
      return;
    }

    state.lastHeartbeatTime = heartbeatValue;
    let timeSinceHeartbeat = now - heartbeatValue;

    if (timeSinceHeartbeat > CONFIG.HEARTBEAT_TIMEOUT) {
      // Heartbeat timeout
      if (state.pro3emOnline) {
        state.pro3emOnline = false;
        logError("💔 Pro 3EM heartbeat timeout (" + Math.floor(timeSinceHeartbeat / 1000) + "s since last heartbeat)");
        emergencyShutdown();
      }
    } else {
      // Heartbeat is fresh
      if (!state.pro3emOnline) {
        // Just came back online
        state.pro3emOnline = true;
        log("💚 Pro 3EM heartbeat detected");
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
             "Heartbeat timeout: " + (CONFIG.HEARTBEAT_TIMEOUT / 1000) + "s\n" +
             "Check interval: " + (CONFIG.HEARTBEAT_CHECK_INTERVAL / 1000) + "s\n" +
             "==============================================\n";
print(header);

log("[OK] Safety protection active!");
log("Waiting for Pro 3EM heartbeat (30s grace period)...");

// Start heartbeat monitoring timer
Timer.set(CONFIG.HEARTBEAT_CHECK_INTERVAL, true, checkHeartbeat);
log("Heartbeat monitor started");
