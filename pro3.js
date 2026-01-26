/******************************************************************************
 * PRO 3 SAFETY PROTECTION SCRIPT
 * Version: 1.3
 * Author: Clément
 *
 * Installation: Shelly Pro 3 → Settings → Scripts → Add Script
 * IP: 10.0.0.101
 *
 * 🛡️ PROTECTION: Emergency shutdown if Pro 3EM heartbeat is lost
 * 📡 MQTT: Publishes relay states and heartbeat status
 *
 * How it works:
 * - Pro 3 sends HTTP heartbeat to Pro 3EM every 10 seconds
 * - Pro 3EM sends HTTP heartbeat to Pro 3 every 10 seconds (bidirectional)
 * - If heartbeat fails → cut all relays (emergency shutdown)
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
  // Network addresses
  PRO3EM_IP: "192.168.1.101",          // Pro 3EM IP address

  // 🔒 SAFETY SETTINGS
  HEARTBEAT_INTERVAL: 10000,        // Send heartbeat every 10s
  MAX_CONSECUTIVE_FAILURES: 3,      // Mark offline after 1 failed heartbeat
  HTTP_TIMEOUT: 5000,               // HTTP request timeout (5s)

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
  pro3em: {},                       // Pro 3EM connection state (initialized by init())
  emergencyShutdownActive: false,   // Are we in emergency shutdown mode?
  relays: {},                       // Relay states (initialized by init())
  heartbeatInProgress: false,       // Guard to prevent concurrent heartbeats
  emergencyShutdownInProgress: false, // Guard to prevent concurrent emergency shutdowns
  heartbeatTimerId: null,           // ID of periodic heartbeat timer (to stop/restart it)
  ethernetConnected: false          // Ethernet connection state
};

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
  // Initialize Pro 3EM connection state
  state.pro3em = {
    online: null,                   // Is Pro 3EM online? (null = unknown, true = online, false = offline)
    consecutiveFailures: 0          // Count of consecutive heartbeat failures
  };

  // Initialize relay states
  for (let i = 0; i < CONFIG.RELAYS.length; i++) {
    state.relays[CONFIG.RELAYS[i]] = {
      on: null,                     // Relay state (true = ON, false = OFF, null = unknown)
      lastUpdate: 0                 // Timestamp of last update
    };
  }

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

function logMQTT(message) {
  if (CONFIG.DEBUG_MQTT) {
    print("[PRO3-SAFETY] [MQTT] " + message);
  }
}

function logError(message) {
  print("[PRO3-SAFETY] ERROR: " + message);
}

function buildRpcUrl(method, params) {
  return "http://" + CONFIG.PRO3EM_IP + "/rpc/" + method + (params ? "?" + params : "");
}

function buildHttpGetParams(url) {
  return {
    url: url,
    timeout: CONFIG.HTTP_TIMEOUT
  };
}

// ============================================================================
// RELAY CONTROL
// ============================================================================

function cutRelay(relayId, onComplete) {
  // Optimistic update - assume the relay will be cut
  state.relays[relayId].on = false;
  state.relays[relayId].lastUpdate = Date.now();

  Shelly.call("Switch.Set", {id: relayId, on: false}, function(_result, error_code, error_message) {
    if (error_code !== 0) {
      logError("Failed to cut relay " + relayId + ": " + error_message);
      // Note: The status handler will update the actual state if it differs
    } else {
      log("✂️ Relay " + relayId + " cut");
    }
    if (onComplete) onComplete();
  });
}

function emergencyShutdown() {
  if (state.emergencyShutdownActive) {
    return; // Already in emergency mode
  }

  // Prevent concurrent emergency shutdowns
  if (state.emergencyShutdownInProgress) {
    log("Emergency shutdown already in progress, skipping");
    return;
  }

  state.emergencyShutdownInProgress = true;
  logError("🚨 EMERGENCY SHUTDOWN: Pro 3EM heartbeat lost - cutting all relays");

  // Cut first relay, which will chain to others via callbacks (NO TIMERS!)
  cutRelay(CONFIG.RELAYS[0], function() {
    cutRelay(CONFIG.RELAYS[1], function() {
      cutRelay(CONFIG.RELAYS[2], function() {
        // All relays cut - publish events
        publishEvent("emergency_shutdown", {
          reason: "pro3em_heartbeat_lost"
        });
        publishRegularStates();

        state.emergencyShutdownActive = true;
        state.emergencyShutdownInProgress = false;
      });
    });
  });
}

function cancelEmergencyShutdown() {
  if (!state.emergencyShutdownActive) {
    return;
  }

  state.emergencyShutdownActive = false;
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

  // Chain callbacks to fetch sequentially - NO TIMERS!
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

  // Fetch relays sequentially
  fetchRelay(CONFIG.RELAYS[0], function() {
    fetchRelay(CONFIG.RELAYS[1], function() {
      fetchRelay(CONFIG.RELAYS[2], function() {
        log("Initial relay states fetched");
      });
    });
  });
}

// ============================================================================
// HEARTBEAT MONITORING
// ============================================================================

function sendHeartbeat() {
  // Prevent concurrent heartbeats
  if (state.heartbeatInProgress) {
    log("Skipping heartbeat (previous one still in progress)");
    return;
  }

  state.heartbeatInProgress = true;
  let url = buildRpcUrl("Shelly.GetStatus", "");

  // Safety timer: force reset heartbeatInProgress after 2x HTTP timeout
  // This prevents infinite lockup if the HTTP callback is never called
  let safetyTimeout = CONFIG.HTTP_TIMEOUT * 2;
  let safetyTimer = Timer.set(safetyTimeout, false, function() {
    if (state.heartbeatInProgress) {
      logError("Heartbeat safety timeout triggered - callback never called");
      state.heartbeatInProgress = false;

      // Count as failure to prevent zombie accumulation
      state.pro3em.consecutiveFailures++;
      if (state.pro3em.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES && state.pro3em.online === true) {
        state.pro3em.online = false;
        logError("💔 Pro 3EM is now OFFLINE (timeout)");

        if (!state.emergencyShutdownInProgress && !state.emergencyShutdownActive) {
          emergencyShutdown();
        }
      }
    }
  });

  Shelly.call("HTTP.GET", buildHttpGetParams(url), function(result, error_code, error_message) {
    // Clear safety timer since callback was called
    Timer.clear(safetyTimer);

    // Capture wasOnline inside callback to avoid closure issues with overlapping heartbeats
    let wasOnline = state.pro3em.online;

    if (error_code !== 0 || !result || result.code !== 200) {
      // Heartbeat failed = Pro 3EM is offline
      state.pro3em.consecutiveFailures++;
      let errorReason = error_code !== 0 ? error_message : "HTTP " + (result ? result.code : "no response");
      log("Heartbeat failed (" + state.pro3em.consecutiveFailures + "/" + CONFIG.MAX_CONSECUTIVE_FAILURES + "): " + errorReason);

      if (state.pro3em.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES && wasOnline === true) {
        state.pro3em.online = false;
        logError("💔 Pro 3EM is now OFFLINE");

        // Trigger emergency shutdown directly (now uses callback chaining, no collision risk)
        if (!state.emergencyShutdownInProgress && !state.emergencyShutdownActive) {
          emergencyShutdown();
        } else {
          log("Emergency shutdown already active or in progress, skipping trigger from heartbeat");
        }
      }
    } else {
      // Heartbeat succeeded = Pro 3EM is online
      state.pro3em.consecutiveFailures = 0;

      if (wasOnline !== true) {
        // Was offline/unknown, now online (reconnection or first connection)
        let isReconnection = wasOnline === false;
        let isFirstConnection = wasOnline === null;
        state.pro3em.online = true;
        log("💚 Pro 3EM is now ONLINE" + (isReconnection ? " (reconnected)" : " (first connection)"));

        if (isReconnection) {
          publishEvent("heartbeat_restored", {});
          cancelEmergencyShutdown();
        } else if (isFirstConnection) {
          // First connection - publish initial state
          publishRegularStates();
        }
      }
    }

    // Release lock after all state updates are done
    state.heartbeatInProgress = false;
  });
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
    emergency_mode: state.emergencyShutdownActive
  });

  publishMQTT("relay" + relayId + "/state", msg, true);
}

function publishRegularStates() {
  // Build status data
  let statusData = {
    pro3em_online: state.pro3em.online,
    emergency_shutdown: state.emergencyShutdownActive
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

  // Handle Ethernet status changes
  if (msg.component === "eth") {
    let ethData = msg.delta || msg.info;
    if (ethData && ethData.ip !== undefined) {
      let wasConnected = state.ethernetConnected;
      let isConnected = ethData.ip !== null;

      if (isConnected !== wasConnected) {
        state.ethernetConnected = isConnected;

        if (isConnected) {
          log("🌐 Ethernet CONNECTED - starting heartbeat");
          // Reset failure count to allow immediate heartbeat
          state.pro3em.consecutiveFailures = 0;
          // Start periodic heartbeat if not already running
          if (state.heartbeatTimerId === null) {
            sendHeartbeat();  // Immediate heartbeat
            state.heartbeatTimerId = Timer.set(CONFIG.HEARTBEAT_INTERVAL, true, sendHeartbeat);
          }
        } else {
          log("🌐 Ethernet DISCONNECTED - stopping heartbeat");
          // Stop periodic heartbeat to prevent zombie accumulation
          if (state.heartbeatTimerId !== null) {
            Timer.clear(state.heartbeatTimerId);
            state.heartbeatTimerId = null;
          }

          // Pro 3EM is unreachable without network - mark offline and trigger emergency shutdown
          if (state.pro3em.online === true) {
            state.pro3em.online = false;
            logError("💔 Pro 3EM is now OFFLINE (no network)");

            if (!state.emergencyShutdownInProgress && !state.emergencyShutdownActive) {
              emergencyShutdown();
            }
          }
        }
      }
    }
    return;
  }

  // Handle Switch status updates
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
             "Pro 3EM IP: " + CONFIG.PRO3EM_IP + "\n" +
             "Monitored relays: " + CONFIG.RELAYS.length + "\n" +
             "Heartbeat interval: " + (CONFIG.HEARTBEAT_INTERVAL / 1000) + "s\n" +
             "Max consecutive failures: " + CONFIG.MAX_CONSECUTIVE_FAILURES + "\n" +
             "MQTT: " + (CONFIG.MQTT_ENABLED ? "Enabled (prefix: " + CONFIG.MQTT_TOPIC_PREFIX + ")" : "Disabled") + "\n" +
             "==============================================\n";
print(header);

log("[OK] Safety protection active!");

// Fetch initial relay states
fetchRelayStates();

// Check Ethernet status before starting heartbeat
Shelly.call("Eth.GetStatus", {}, function(result, error_code) {
  if (error_code === 0 && result && result.ip !== null) {
    // Ethernet is connected - start heartbeat
    state.ethernetConnected = true;
    sendHeartbeat();  // Initial heartbeat
    state.heartbeatTimerId = Timer.set(CONFIG.HEARTBEAT_INTERVAL, true, sendHeartbeat);
    log("Ethernet connected - HTTP heartbeat started (every " + (CONFIG.HEARTBEAT_INTERVAL/1000) + "s)");
  } else {
    // Ethernet not connected - heartbeat will start when connection detected
    state.ethernetConnected = false;
    log("Ethernet not connected - heartbeat will start when connection is established");
  }
});

// 📡 Setup MQTT periodic publication
if (CONFIG.MQTT_ENABLED) {
  Timer.set(CONFIG.MQTT_PUBLISH_INTERVAL, true, publishRegularStates);
  log("MQTT state publication every " + (CONFIG.MQTT_PUBLISH_INTERVAL/1000) + "s");
  logMQTT("Initial states will be published on first successful heartbeat");
}

// Register status handler for switch updates
Shelly.addStatusHandler(handleStatusUpdate);
log("Status handler registered for switch updates");
