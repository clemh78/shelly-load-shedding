/******************************************************************************
 * PRO 3 SAFETY PROTECTION SCRIPT
 * Author: Clément
 *
 * Installation: Shelly Pro 3 → Settings → Scripts → Add Script
 * IP: 10.0.0.101
 *
 * 🛡️ PROTECTION: Emergency shutdown if Pro 3EM heartbeat is lost
 * 📡 MQTT: Publishes relay states and heartbeat status
 *
 * How it works:
 * - Pro 3 exposes HTTP endpoint /heartbeat via HTTPServer
 * - Pro 3EM calls this endpoint every 10 seconds
 * - Pro 3 monitors last heartbeat timestamp
 * - If no heartbeat for 30s → cut all relays (emergency shutdown)
 * - When heartbeat resumes → log recovery (Pro 3EM will restore relays)
 * - Publishes relay states and events to MQTT
 *
 * MQTT Topics (prefix: load-shedding-ece334f88154):
 * - /status                 : Global status (relays, heartbeat, emergency mode)
 * - /events                 : All events (relay changes, heartbeat, emergency)
 * - /relay{0,1,2}/state     : Individual relay state (retained)
 * - /relay{0,1,2}/event     : Relay-specific events
 ******************************************************************************/

// ============================================================================
// CONFIGURATION
// ============================================================================

let CONFIG = {
  // Script version
  VERSION: "1.4",

  // 🔒 SAFETY SETTINGS
  // CRITICAL: Pro3EM must detect offline BEFORE Pro3 triggers emergency shutdown
  // Pro3EM detection time: ~15s (see HEARTBEAT_INTERVAL + HTTP_TIMEOUT in pro3em.js)
  // Pro3 emergency trigger: 60s (HEARTBEAT_TIMEOUT below)
  // Safety margin: ~45s - ensures Pro3EM marks Pro3 offline and will re-sync when connection restored
  HEARTBEAT_CHECK_INTERVAL: 5000,   // Check for missing heartbeat every 5s
  HEARTBEAT_TIMEOUT: 60000,         // Emergency shutdown if no heartbeat for 60s (6x expected interval from Pro3EM)
  HEARTBEAT_GRACE_PERIOD: 30000,    // Grace period after startup/first connection before enforcing timeout (30s)
  EMERGENCY_SHUTDOWN_TIMEOUT: 10000, // Force emergency mode if relay cuts don't complete within 10s

  // Debug mode
  DEBUG: true,
  DEBUG_MQTT: false,                // Enable verbose MQTT logs (separate from DEBUG)

  // Relay configuration
  RELAYS: [0, 1, 2],  // Pro 3 has 3 relays

  // 📡 MQTT
  MQTT_ENABLED: true,                      // Enable MQTT publishing
  MQTT_TOPIC_PREFIX: "load-shedding-ece334f88154",               // MQTT topic prefix
  MQTT_PUBLISH_INTERVAL: 30000             // Publish states every 30s
};

// ============================================================================
// GLOBAL STATE
// ============================================================================

let state = {
  // 📡 Pro 3EM Connection & Heartbeat
  heartbeat: {
    online: null,                   // Is Pro 3EM online? (null = unknown, true = online, false = offline)
    lastPing: null,                 // Timestamp of last heartbeat received from Pro3EM (null = never received)
    firstPing: null,                // Timestamp of first heartbeat received (for grace period)
    timerId: null                   // ID of periodic heartbeat check timer
  },

  // 🛡️ Emergency Shutdown Management
  emergencyShutdown: {
    active: false,                  // Are we in emergency shutdown mode?
    activationInProgress: false     // Guard to prevent concurrent emergency shutdowns
  },

  // 🔌 Relay States
  relays: {},                       // Relay states (initialized by init())

  // ⏱️ Metadata
  startTime: Date.now()             // Script start timestamp for uptime calculation
};

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
  // Initialize relay states
  for (let i = 0; i < CONFIG.RELAYS.length; i++) {
    state.relays[CONFIG.RELAYS[i]] = {
      on: null,                     // Relay state (true = ON, false = OFF, null = unknown)
      lastUpdate: 0                 // Timestamp of last update
    };
  }

  log("Pro 3 Safety Protection initialized");
  log("Heartbeat timeout: " + (CONFIG.HEARTBEAT_TIMEOUT / 1000) + "s");
  log("Heartbeat check interval: " + (CONFIG.HEARTBEAT_CHECK_INTERVAL / 1000) + "s");
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

function logMQTT(message) {
  if (CONFIG.DEBUG_MQTT) {
    print("[PRO3-SAFETY] [MQTT] " + message);
  }
}

function logError(message) {
  print("[PRO3-SAFETY] ERROR: " + message);
}

// ============================================================================
// RELAY CONTROL
// ============================================================================

// Helper to chain relay operations sequentially
function chainRelayOperations(relayIds, operation, onComplete) {
  if (relayIds.length === 0) {
    if (onComplete) onComplete();
    return;
  }

  let relayId = relayIds[0];
  let remaining = relayIds.slice(1);

  operation(relayId, function() {
    chainRelayOperations(remaining, operation, onComplete);
  });
}

function cutRelay(relayId, onComplete) {
  Shelly.call("Switch.Set", {id: relayId, on: false}, function(_result, error_code, error_message) {
    if (error_code !== 0) {
      logError("Failed to cut relay " + relayId + ": " + error_message);
      // Note: The status handler will update the actual state if it differs
    } else {
      // Update state only on success
      state.relays[relayId].on = false;
      state.relays[relayId].lastUpdate = Date.now();
      log("✂️ Relay " + relayId + " cut");
    }
    if (onComplete) onComplete();
  });
}

function emergencyShutdown() {
  if (state.emergencyShutdown.active) {
    return; // Already in emergency mode
  }

  // Prevent concurrent emergency shutdowns
  if (state.emergencyShutdown.activationInProgress) {
    log("Emergency shutdown already in progress, skipping");
    return;
  }

  state.emergencyShutdown.activationInProgress = true;
  logError("🚨 EMERGENCY SHUTDOWN: Pro 3EM heartbeat lost - cutting all relays");

  // Safety timeout: force emergency mode if callbacks don't complete
  let safetyTimeout = Timer.set(CONFIG.EMERGENCY_SHUTDOWN_TIMEOUT, false, function() {
    if (state.emergencyShutdown.activationInProgress) {
      logError("Emergency shutdown timeout - forcing emergency mode");
      state.emergencyShutdown.active = true;
      state.emergencyShutdown.activationInProgress = false;
    }
  });

  // Cut all relays sequentially via chained callbacks
  chainRelayOperations(CONFIG.RELAYS, cutRelay, function() {
    // Cancel safety timeout - we completed successfully
    Timer.clear(safetyTimeout);

    // All relays cut - publish events
    publishEvent("emergency_shutdown", {
      reason: "pro3em_heartbeat_lost"
    });
    publishRegularStates();

    state.emergencyShutdown.active = true;
    state.emergencyShutdown.activationInProgress = false;
  });
}

function cancelEmergencyShutdown() {
  if (!state.emergencyShutdown.active) {
    return;
  }

  state.emergencyShutdown.active = false;
  log("✅ Pro 3EM heartbeat restored - emergency mode cancelled");
  log("   (Relays will be restored by Pro 3EM load shedding logic)");

  // Publish event and state
  publishEvent("emergency_cancelled", {
    reason: "pro3em_heartbeat_restored"
  });
  publishRegularStates();
}

function fetchRelayStates() {
  log("Fetching initial relay states...");

  function fetchRelay(relayId, onComplete) {
    Shelly.call("Switch.GetStatus", {id: relayId}, function(result, error_code, error_message) {
      if (error_code !== 0) {
        logError("Failed to get relay " + relayId + " status: " + error_message);
      } else if (result && result.output !== undefined) {
        state.relays[relayId].on = result.output;
        state.relays[relayId].lastUpdate = Date.now();
        log("Relay " + relayId + " initial state: " + (result.output ? "ON" : "OFF"));
      } else {
        logError("Invalid result from relay " + relayId + " status");
      }
      if (onComplete) onComplete();
    });
  }

  // Fetch all relays sequentially via chained callbacks
  chainRelayOperations(CONFIG.RELAYS, fetchRelay, function() {
    log("Initial relay states fetched");
  });
}

// ============================================================================
// HEARTBEAT MONITORING (HTTP ENDPOINT)
// ============================================================================

// HTTP endpoint handler for /heartbeat (called by Pro3EM)
function handleHeartbeat(_request, response) {
  let now = Date.now();
  let wasOnline = state.heartbeat.online;

  // Update last heartbeat timestamp
  state.heartbeat.lastPing = now;

  // Record first heartbeat timestamp (for grace period)
  if (state.heartbeat.firstPing === null) {
    state.heartbeat.firstPing = now;
    log("First heartbeat received - grace period active for " + (CONFIG.HEARTBEAT_GRACE_PERIOD / 1000) + "s");
  }

  // Mark Pro3EM as online
  if (wasOnline !== true) {
    // Was offline/unknown, now online (reconnection or first connection)
    let isReconnection = wasOnline === false;
    let isFirstConnection = wasOnline === null;
    state.heartbeat.online = true;
    log("💚 Pro 3EM is now ONLINE" + (isReconnection ? " (reconnected)" : " (first connection)"));

    // Reset grace period on reconnection (to allow Pro3EM time to resync)
    if (isReconnection) {
      state.heartbeat.firstPing = now;
      log("Grace period reactivated for " + (CONFIG.HEARTBEAT_GRACE_PERIOD / 1000) + "s (allows Pro3EM to resync)");
      publishEvent("heartbeat_restored", {});
      cancelEmergencyShutdown();
    } else if (isFirstConnection) {
      // First connection - publish initial state
      publishRegularStates();
    }
  }

  // Build response with relay states
  let relayStates = {};
  for (let i = 0; i < CONFIG.RELAYS.length; i++) {
    let relayId = CONFIG.RELAYS[i];
    relayStates["relay" + relayId] = state.relays[relayId].on;
  }

  // Calculate uptime
  let uptimeSeconds = Math.floor((now - state.startTime) / 1000);

  // Send response
  response.code = 200;
  response.headers = [["Content-Type", "application/json"]];
  response.body = JSON.stringify({
    status: "ok",
    version: CONFIG.VERSION,
    timestamp: now,
    uptime_seconds: uptimeSeconds,
    emergency_mode: state.emergencyShutdown.active,
    relays: relayStates
  });
  response.send();

  log("Heartbeat received from Pro3EM");
}

// Check if heartbeat timeout has elapsed
function checkHeartbeatTimeout() {
  // Skip check if we never received a heartbeat yet
  if (state.heartbeat.lastPing === null) {
    log("Waiting for first heartbeat from Pro3EM...");
    return;
  }

  let now = Date.now();
  let elapsed = now - state.heartbeat.lastPing;

  // Check if we're still in grace period (after startup or first connection)
  if (state.heartbeat.firstPing !== null) {
    let timeSinceFirst = now - state.heartbeat.firstPing;
    if (timeSinceFirst < CONFIG.HEARTBEAT_GRACE_PERIOD) {
      log("Grace period active (" + (timeSinceFirst / 1000).toFixed(1) + "s / " + (CONFIG.HEARTBEAT_GRACE_PERIOD / 1000) + "s) - heartbeat timeout check skipped");
      return;
    }
  }

  // Log periodic status for monitoring
  if (state.heartbeat.online === true) {
    log("Heartbeat OK (last received " + (elapsed / 1000).toFixed(1) + "s ago)");
  }

  if (elapsed > CONFIG.HEARTBEAT_TIMEOUT) {
    // Heartbeat timeout - Pro3EM is offline
    if (state.heartbeat.online === true) {
      state.heartbeat.online = false;
      logError("💔 Pro 3EM is now OFFLINE (heartbeat timeout: " + (elapsed / 1000).toFixed(1) + "s)");

      // Trigger emergency shutdown
      if (!state.emergencyShutdown.activationInProgress && !state.emergencyShutdown.active) {
        emergencyShutdown();
      }
    }
  }
}

// ============================================================================
// MQTT FUNCTIONS
// ============================================================================

function publishMQTT(topic, payload, retain) {
  if (!CONFIG.MQTT_ENABLED) return;

  // Check if MQTT is connected before publishing
  if (!MQTT.isConnected()) {
    logMQTT("MQTT not connected, skipping publish to: " + topic);
    return;
  }

  let fullTopic = CONFIG.MQTT_TOPIC_PREFIX + "/" + topic;
  let message = typeof payload === "object" ? JSON.stringify(payload) : String(payload);

  MQTT.publish(fullTopic, message, 0, retain);
  logMQTT(fullTopic + " = " + message);
}

function createRPCMessage(method, data) {
  return {
    method: method,
    params: {
      ts: Date.now(),
      data: data
    }
  };
}

function publishRelayState(relayId, relayOn) {
  let msg = createRPCMessage("NotifyState", {
    relay: relayId,
    active: relayOn,
    emergency_mode: state.emergencyShutdown.active
  });

  publishMQTT("relay" + relayId + "/state", msg, true);
}

function publishRegularStates() {
  // Build status data
  let statusData = {
    pro3em_online: state.heartbeat.online,
    emergency_shutdown: state.emergencyShutdown.active
  };

  // Add relay states and publish individual states
  for (let i = 0; i < CONFIG.RELAYS.length; i++) {
    let relayId = CONFIG.RELAYS[i];
    let relayState = state.relays[relayId];

    // Only publish if relay state is known (not null)
    if (relayState && relayState.on !== null) {
      statusData["relay" + relayId + "_on"] = relayState.on;
      // Publish individual relay state
      publishRelayState(relayId, relayState.on);
    } else {
      // Mark relay state as unknown in status
      statusData["relay" + relayId + "_on"] = "unknown";
      log("Relay " + relayId + " state unknown, skipping individual state publish");
    }
  }

  // Publish global status
  let msg = createRPCMessage("NotifyStatus", statusData);
  publishMQTT("status", msg, false);

  logMQTT("Regular states published");
}

function publishEvent(eventType, data, specificTopic) {
  let msg = createRPCMessage("NotifyEvent", {
    event: eventType,
    data: data
  });

  // Always publish to global events topic
  publishMQTT("events", msg, false);

  // Also publish to specific topic if provided
  if (specificTopic) {
    publishMQTT(specificTopic, msg, false);
  }
}

// ============================================================================
// STATUS HANDLER
// ============================================================================

function handleStatusUpdate(msg) {
  if (!msg || !msg.component) return;

  // Handle Switch status updates only
  if (msg.component.indexOf("switch:") !== 0) return;

  // Extract relay ID from component name (e.g., "switch:0" -> 0)
  let relayId = parseInt(msg.component.split(":")[1]);

  // Check if this is one of our monitored relays
  if (CONFIG.RELAYS.indexOf(relayId) === -1) return;

  // Use delta if available, otherwise use full info
  let switchData = msg.delta || msg.info;
  if (!switchData || switchData.output === undefined) return;

  // Update relay state
  let oldState = state.relays[relayId].on;
  let newState = switchData.output;

  state.relays[relayId].on = newState;
  state.relays[relayId].lastUpdate = Date.now();

  // Log state change and publish immediately
  if (oldState !== newState) {
    log("Relay " + relayId + " state changed: " + (oldState === null ? "unknown" : (oldState ? "ON" : "OFF")) + " -> " + (newState ? "ON" : "OFF"));

    // Publish individual relay state immediately
    publishRelayState(relayId, newState);

    // Publish event (to global events and relay-specific topic)
    publishEvent("relay_changed", {
      relay: relayId,
      old_state: oldState,
      new_state: newState
    }, "relay" + relayId + "/event");
  }
}

// ============================================================================
// STARTUP
// ============================================================================

init();

let header = "\n" +
             "==============================================\n" +
             "  PRO 3 SAFETY PROTECTION\n" +
             "==============================================\n" +
             "Monitored relays: " + CONFIG.RELAYS.length + "\n" +
             "Heartbeat timeout: " + (CONFIG.HEARTBEAT_TIMEOUT / 1000) + "s\n" +
             "Grace period: " + (CONFIG.HEARTBEAT_GRACE_PERIOD / 1000) + "s\n" +
             "Check interval: " + (CONFIG.HEARTBEAT_CHECK_INTERVAL / 1000) + "s\n" +
             "HTTPServer endpoint: /script/1/heartbeat\n" +
             "MQTT: " + (CONFIG.MQTT_ENABLED ? "Enabled (prefix: " + CONFIG.MQTT_TOPIC_PREFIX + ")" : "Disabled") + "\n" +
             "==============================================\n";
print(header);

log("[OK] Safety protection active!");

// Fetch initial relay states
fetchRelayStates();

// Register HTTPServer endpoint for heartbeat
HTTPServer.registerEndpoint("heartbeat", handleHeartbeat);
log("HTTPServer endpoint registered: /script/1/heartbeat");

// Start periodic heartbeat check timer
state.heartbeat.timerId = Timer.set(CONFIG.HEARTBEAT_CHECK_INTERVAL, true, checkHeartbeatTimeout);
log("Heartbeat monitoring started (check every " + (CONFIG.HEARTBEAT_CHECK_INTERVAL/1000) + "s, timeout: " + (CONFIG.HEARTBEAT_TIMEOUT/1000) + "s)");

// 📡 Setup MQTT periodic publication
if (CONFIG.MQTT_ENABLED) {
  Timer.set(CONFIG.MQTT_PUBLISH_INTERVAL, true, publishRegularStates);
  log("MQTT state publication every " + (CONFIG.MQTT_PUBLISH_INTERVAL/1000) + "s");
  logMQTT("Initial states will be published on first successful heartbeat");
}

// Register status handler for relay state changes
Shelly.addStatusHandler(handleStatusUpdate);
log("Status handler registered for relay state changes");
