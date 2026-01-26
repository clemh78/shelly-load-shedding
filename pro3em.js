/******************************************************************************
 * INTELLIGENT THREE-PHASE LOAD SHEDDING - Pro 3EM
 * Version: 1.2
 * Author: Clément
 *
 * Installation: Shelly Pro 3EM → Settings → Scripts → Add Script
 * IP: 10.0.0.100
 *
 * ⚙️ SIMULATION MODE: Leave PRO3_IP empty for testing without hardware
 ******************************************************************************/

// ============================================================================
// CONFIGURATION
// ============================================================================

let CONFIG = {
  // Network addresses (leave empty for simulation mode)
  PRO3_IP: "192.168.1.103",                // Set to Pro 3EM IP (e.g., "10.0.0.101") or leave empty for simulation

  // ⚡ PHASE CONFIGURATION
  PHASES: {
    L1: {
      relayIndex: 0,
      emField: "a_current",           // Field name in EM.GetStatus
      sheddingThreshold: 28,          // 2A margin (uses 93% of rating)
      restorationThreshold: 26        // 2A hysteresis
    },
    L2: {
      relayIndex: 1,
      emField: "b_current",
      sheddingThreshold: 28,
      restorationThreshold: 26
    },
    L3: {
      relayIndex: 2,
      emField: "c_current",
      sheddingThreshold: 28,
      restorationThreshold: 26
    }
  },
  
  // Timings
  SHEDDING_DELAY: 2000,         // 2s delay before shedding (circuit breaker tolerates peaks)
  RESTORATION_DELAY: 300000,    // 5min (300s) before restoring

  // Thresholds
  IMMEDIATE_SHEDDING_MULTIPLIER: 1.2,  // Immediate shedding at 120% of threshold

  // Debug mode
  DEBUG: true,
  DEBUG_MQTT: false,                // Enable verbose MQTT logs (separate from DEBUG)

  // 📡 MQTT
  MQTT_ENABLED: true,         // Enable MQTT publishing
  MQTT_TOPIC_PREFIX: "load-shedding-14335cc56020",  // MQTT topic prefix
  MQTT_PUBLISH_INTERVAL: 30000,     // Publish states every 30s

  // 🔌 PRO 3 CONNECTION
  HEARTBEAT_INTERVAL: 10000,        // Heartbeat check every 10s
  MAX_CONSECUTIVE_FAILURES: 1,      // Mark offline after 1 failed heartbeat
  HTTP_TIMEOUT: 5000                // HTTP request timeout (5s)
};

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

let state = {
  phases: {},                       // Initialized by init()
  pro3: {},                         // Initialized by init()
  heartbeatInProgress: false,       // Guard to prevent concurrent heartbeats
  syncInProgress: false,            // Guard to prevent concurrent sync operations
  heartbeatTimerId: null,           // ID of periodic heartbeat timer (to stop/restart it)
  ethernetConnected: false          // Ethernet connection state
};

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
  // Initialize phase states from CONFIG.PHASES
  for (let phaseName in CONFIG.PHASES) {
    state.phases[phaseName] = {
      relay: true,                  // true = ON, false = OFF
      status: "NORMAL",             // NORMAL | WARNING | CRITICAL | SHED
      current: 0,                   // Last measured current (A)
      overloadStartTime: null,      // Timestamp when overload started (null = no overload)
      lastShedding: 0               // Timestamp of last shedding
    };
  }

  // Initialize Pro 3 connection state
  state.pro3 = {
    online: false,
    consecutiveFailures: 0
  };

  log("Phases initialized: " + Object.keys(state.phases).join(", "));
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(message) {
  if (CONFIG.DEBUG) {
    print("[PRO3EM] " + message);
  }
}

function logMQTT(message) {
  if (CONFIG.DEBUG_MQTT) {
    print("[PRO3EM] [MQTT] " + message);
  }
}

function logError(message) {
  print("[PRO3EM] ERROR: " + message);
}

function buildRpcUrl(method, params) {
  return "http://" + CONFIG.PRO3_IP + "/rpc/" + method + "?" + params;
}

function buildHttpGetParams(url) {
  return {
    url: url,
    timeout: CONFIG.HTTP_TIMEOUT
  };
}

function validateCurrent(value, phaseName) {
  // Return 0 if value is invalid (NaN, negative, or not a number)
  if (typeof value !== "number" || isNaN(value) || value < 0) {
    logError("Invalid current value for " + phaseName + ": " + value);
    return 0;
  }
  return value;
}

function sendCommand(phaseName, action, onComplete) {
  let isOn = (action === "on");

  // Log action
  log("ACTION: " + phaseName + " -> " + action.toUpperCase());

  // Send real command via RPC API if PRO3_IP is configured
  if (CONFIG.PRO3_IP) {
    // Check if Pro 3 is online before sending command
    if (!state.pro3.online) {
      logError("Cannot send command to " + phaseName + " - Pro 3 is OFFLINE");
      if (onComplete) onComplete();
      return;
    }

    let relay = CONFIG.PHASES[phaseName].relayIndex;
    let url = buildRpcUrl("Switch.Set", "id=" + relay + "&on=" + isOn);

    Shelly.call("HTTP.GET", buildHttpGetParams(url), function(result, error_code, error_message) {
      if (error_code !== 0 || !result || result.code !== 200) {
        let errorReason = error_code !== 0 ? error_message : "HTTP " + (result ? result.code : "no response");
        logError("Relay command " + phaseName + ": " + errorReason);
      } else {
        log("Command sent: " + phaseName + " -> " + action);
      }
      if (onComplete) onComplete();
    });
  } else {
    log("SIMULATION: Would send " + action + " to " + phaseName);
    if (onComplete) onComplete();
  }

  // Publish relay state on MQTT
  publishRelayState(phaseName, isOn);
}

function syncRelayState(phaseName, onComplete) {
  let phaseConfig = CONFIG.PHASES[phaseName];
  let phaseState = state.phases[phaseName];
  let relayIndex = phaseConfig.relayIndex;
  let desiredState = phaseState.relay;

  // Query actual relay state
  let url = buildRpcUrl("Switch.GetStatus", "id=" + relayIndex);

  Shelly.call("HTTP.GET", buildHttpGetParams(url), function(result, error_code, error_message) {
    if (error_code !== 0 || !result || result.code !== 200) {
      let errorReason = error_code !== 0 ? error_message : "HTTP " + (result ? result.code : "no response");
      logError("SYNC: Failed to get relay " + phaseName + " status: " + errorReason);
      if (onComplete) onComplete();
      return;
    }

    // Parse the response to get actual relay state
    let parsedBody = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
    let actualState = parsedBody ? parsedBody.output : null;

    if (actualState === null || actualState === undefined) {
      logError("SYNC: Could not parse relay " + phaseName + " state");
      if (onComplete) onComplete();
      return;
    }

    // Compare and sync if different
    if (actualState !== desiredState) {
      log("SYNC: " + phaseName + " mismatch - actual: " + (actualState ? "ON" : "OFF") + " [" + actualState + "], desired: " + (desiredState ? "ON" : "OFF") + " [" + desiredState + "]");
      sendCommand(phaseName, desiredState ? "on" : "off", onComplete);
    } else {
      log("SYNC: " + phaseName + " is in sync (" + (actualState ? "ON" : "OFF") + ")");
      if (onComplete) onComplete();
    }
  });
}

function syncRelayStates() {
  if (!CONFIG.PRO3_IP) {
    return;
  }

  // Prevent concurrent sync operations (important during network reconnection)
  if (state.syncInProgress) {
    log("SYNC: Already in progress, skipping");
    return;
  }

  state.syncInProgress = true;
  log("SYNC: Starting relay synchronization...");

  // Chain callbacks to sync sequentially - NO TIMERS created!
  let phaseNames = Object.keys(CONFIG.PHASES);

  // Sync all phases in sequence
  syncRelayState(phaseNames[0], function() {
    syncRelayState(phaseNames[1], function() {
      syncRelayState(phaseNames[2], function() {
        // All done
        state.syncInProgress = false;
        log("SYNC: Completed");
      });
    });
  });
}

function sendHeartbeat() {
  if (!CONFIG.PRO3_IP) {
    return;
  }

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
      state.pro3.consecutiveFailures++;
      if (state.pro3.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES && state.pro3.online) {
        state.pro3.online = false;
        logError("Pro 3 is now OFFLINE (timeout)");
      }
    }
  });

  Shelly.call("HTTP.GET", buildHttpGetParams(url), function(result, error_code, error_message) {
    // Clear safety timer since callback was called
    Timer.clear(safetyTimer);

    // Capture wasOnline inside callback to avoid closure issues with overlapping heartbeats
    let wasOnline = state.pro3.online;

    if (error_code !== 0 || !result || result.code !== 200) {
      // Heartbeat failed = Pro 3 is offline
      state.pro3.consecutiveFailures++;
      let errorReason = error_code !== 0 ? error_message : "HTTP " + (result ? result.code : "no response");
      log("Heartbeat failed (" + state.pro3.consecutiveFailures + "/" + CONFIG.MAX_CONSECUTIVE_FAILURES + "): " + errorReason);

      if (state.pro3.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES && wasOnline) {
        state.pro3.online = false;
        logError("Pro 3 is now OFFLINE");
      }
    } else {
      // Heartbeat succeeded = Pro 3 is online
      state.pro3.consecutiveFailures = 0;

      if (!wasOnline) {
        // Was offline, now online (reconnection or first connection at startup)
        state.pro3.online = true;
        log("Pro 3 is now ONLINE - triggering relay synchronization");

        // Trigger sync directly (now uses callback chaining, no collision risk)
        if (!state.syncInProgress) {
          syncRelayStates();
        } else {
          log("SYNC: Already in progress, skipping trigger from heartbeat");
        }
      }
      // else: already online, everything ok (no action needed)
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

function publishRelayState(phaseName, relayState) {
  let msg = createRPCMessage("NotifyState", {
    phase: phaseName,
    active: relayState,
    status: state.phases[phaseName].status
  });

  publishMQTT(phaseName + "/state", msg, true);
}

function publishEvent(phaseName, action, current) {
  let msg = createRPCMessage("NotifyEvent", {
    phase: phaseName,
    relay: CONFIG.PHASES[phaseName].relayIndex,
    action: action,
    current: current ? current.toFixed(2) : null,
    status: state.phases[phaseName].status
  });

  publishMQTT("events", msg, false);
  publishMQTT(phaseName + "/event", msg, false);
}

function publishRegularStates() {
  // Build global status and publish individual relay states
  let statusData = {};
  for (let phaseName in state.phases) {
    let phaseState = state.phases[phaseName];

    // Publish individual relay state
    publishRelayState(phaseName, phaseState.relay);

    // Add to global status
    let phaseKey = phaseName.toLowerCase();
    statusData[phaseKey + "_active"] = phaseState.relay;
    statusData[phaseKey + "_status"] = phaseState.status;
  }

  // Add Pro 3 online status
  statusData.pro3_online = state.pro3.online;

  // Publish global status
  let msg = createRPCMessage("NotifyStatus", statusData);
  publishMQTT("status", msg, false);

  logMQTT("Regular states published");
}

// ============================================================================
// SHEDDING LOGIC
// ============================================================================

function logPhaseMeasurements(emData) {
  let measurements = [];

  for (let phaseName in CONFIG.PHASES) {
    let phaseConfig = CONFIG.PHASES[phaseName];
    let phaseState = state.phases[phaseName];
    let rawCurrent = emData[phaseConfig.emField];
    let current = validateCurrent(rawCurrent !== undefined ? rawCurrent : 0, phaseName);

    // Status indicator based on phase state
    let indicator;
    if (phaseState.status === "SHED") {
      indicator = "[SHED]";
    } else if (phaseState.status === "CRITICAL") {
      indicator = "[CRIT]";
    } else if (phaseState.status === "WARNING") {
      indicator = "[WARN]";
    } else {
      indicator = "[OK]";
    }

    // Build measurement with relay state and status
    let relayState = phaseState.relay ? "ON" : "OFF";
    let measurement = indicator + phaseName + "=" + current.toFixed(2) + "A(" + relayState + "," + phaseState.status;

    // Add restoration countdown if phase is shed and ready to restore
    if (phaseState.status === "SHED") {
      let elapsed = Date.now() - phaseState.lastShedding;
      let remaining = Math.floor((CONFIG.RESTORATION_DELAY - elapsed) / 1000);
      if (remaining > 0) {
        measurement += ",↻" + remaining + "s";
      }
    }

    measurement += ")";
    measurements.push(measurement);
  }

  log("Measurements: " + measurements.join("  "));
}

function checkPhase(phaseName, current) {
  let now = Date.now();
  let phaseState = state.phases[phaseName];
  let phaseConfig = CONFIG.PHASES[phaseName];

  // Update current measurement
  phaseState.current = current;

  // ---- OVERLOAD DETECTION ----
  if (current > phaseConfig.sheddingThreshold) {
    // Start tracking overload time if not already tracking
    if (phaseState.overloadStartTime === null) {
      phaseState.overloadStartTime = now;
      phaseState.status = "CRITICAL";
      log("OVERLOAD detected " + phaseName + ": " + current.toFixed(2) + "A > " + phaseConfig.sheddingThreshold + "A");
    }

    // Only shed if relay is still ON
    if (!phaseState.relay) return;

    let overloadDuration = now - phaseState.overloadStartTime;

    // Check if shedding is needed
    let shouldShed = false;
    let sheddingType = "";

    if (current > phaseConfig.sheddingThreshold * CONFIG.IMMEDIATE_SHEDDING_MULTIPLIER) {
      // Immediate shedding if well above threshold
      shouldShed = true;
      sheddingType = "immediate";
      log("IMMEDIATE SHEDDING " + phaseName + " (overload > " + (CONFIG.IMMEDIATE_SHEDDING_MULTIPLIER * 100) + "%)");
    } else if (overloadDuration >= CONFIG.SHEDDING_DELAY) {
      // Normal shedding after delay
      shouldShed = true;
      sheddingType = "normal";
      log("SHEDDING " + phaseName + " (overload for " + (overloadDuration/1000).toFixed(1) + "s)");
    }

    if (shouldShed) {
      sendCommand(phaseName, "off");
      phaseState.relay = false;
      phaseState.lastShedding = now;
      phaseState.status = "SHED";
      
      publishEvent(phaseName, sheddingType + "_shedding", current);
    }
  }
  // ---- NO OVERLOAD ----
  else {
    // Reset overload tracking only if relay is ON
    if (phaseState.overloadStartTime !== null && phaseState.relay) {
      log("CANCEL overload tracking " + phaseName + " (current back to normal)");
      phaseState.overloadStartTime = null;
    }

    // ---- STATUS UPDATE OR RESTORATION ----
    if (phaseState.relay) {
      // Relay is ON - update status based on current level
      phaseState.status = current < phaseConfig.restorationThreshold ? "NORMAL" : "WARNING";
    } else {
      // Relay is OFF (SHED) - check for restoration
      if (current < phaseConfig.restorationThreshold) {
        let elapsed = now - phaseState.lastShedding;

        if (elapsed >= CONFIG.RESTORATION_DELAY) {
          log("RESTORATION " + phaseName + " (delay " + (CONFIG.RESTORATION_DELAY/1000) + "s elapsed)");
          sendCommand(phaseName, "on");
          phaseState.relay = true;
          phaseState.status = "NORMAL";
          phaseState.overloadStartTime = null;

          publishEvent(phaseName, "restoration", current);
        }
      }
    }
  }
}

// ============================================================================
// MAIN CYCLE (triggered by status updates)
// ============================================================================

function handleEMStatusUpdate(msg) {
  // Only process EM status updates (ignore other component updates)
  if (!msg || !msg.component || msg.component !== "em:0") return;

  // Use delta if available, otherwise use full info
  let emData = msg.delta || msg.info;
  if (!emData) return;

  // Check all phases
  for (let phaseName in CONFIG.PHASES) {
    let rawCurrent = emData[CONFIG.PHASES[phaseName].emField];
    let current = validateCurrent(rawCurrent !== undefined ? rawCurrent : 0, phaseName);
    checkPhase(phaseName, current);
  }

  // Log measurements
  logPhaseMeasurements(emData);
}

// ============================================================================
// STARTUP
// ============================================================================

// Initialize state
init();

let mode = CONFIG.PRO3_IP ? "PRODUCTION MODE" : "SIMULATION MODE";
let header = "\n" +
             "==============================================\n" +
             "  INTELLIGENT THREE-PHASE LOAD SHEDDING\n" +
             "==============================================\n" +
             "MODE: " + mode + "\n" +
             (CONFIG.PRO3_IP ? "-> Real commands sent to Pro 3EM\n" : "-> Simulation mode (no commands sent)\n") +
             "==============================================\n";
print(header);

// Build thresholds info dynamically
let thresholdsInfo = "";
for (let phaseName in CONFIG.PHASES) {
  let cfg = CONFIG.PHASES[phaseName];
  thresholdsInfo += phaseName + ": shed=" + cfg.sheddingThreshold + "A, restore=" + cfg.restorationThreshold + "A\n";
}

let startMsg = (CONFIG.PRO3_IP ? "Pro 3 IP: " + CONFIG.PRO3_IP + "\n" : "") +
               "Phase thresholds:\n" + thresholdsInfo +
               "Restoration delay: " + (CONFIG.RESTORATION_DELAY/1000) + "s\n" +
               "MQTT: " + (CONFIG.MQTT_ENABLED ? "Enabled (prefix: " + CONFIG.MQTT_TOPIC_PREFIX + ")" : "Disabled") + "\n\n" +
               "[OK] System operational!\n";

log(startMsg);

// 📡 Publish initial states on MQTT
if (CONFIG.MQTT_ENABLED) {
  publishRegularStates();
  logMQTT("Initial states published");
  Timer.set(CONFIG.MQTT_PUBLISH_INTERVAL, true, publishRegularStates);
  log("MQTT state publication every " + (CONFIG.MQTT_PUBLISH_INTERVAL/1000) + "s");
}

// 🔌 Start heartbeat monitoring and safety protection
if (CONFIG.PRO3_IP) {
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
} else {
  log("Simulation mode - heartbeat monitoring disabled");
}

// Register status handler (triggered on EM updates and network changes)
Shelly.addStatusHandler(function(msg) {
  // Handle EM status updates
  handleEMStatusUpdate(msg);

  // Handle Ethernet status changes
  if (CONFIG.PRO3_IP && msg && msg.component === "eth") {
    let ethData = msg.delta || msg.info;
    if (ethData && ethData.ip !== undefined) {
      let wasConnected = state.ethernetConnected;
      let isConnected = ethData.ip !== null;

      if (isConnected !== wasConnected) {
        state.ethernetConnected = isConnected;

        if (isConnected) {
          log("🌐 Ethernet CONNECTED - starting heartbeat");
          // Reset failure count to allow immediate heartbeat
          state.pro3.consecutiveFailures = 0;
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

          // Pro 3 is unreachable without network - mark offline
          if (state.pro3.online) {
            state.pro3.online = false;
            logError("Pro 3 is now OFFLINE (no network)");
          }
        }
      }
    }
  }
});
log("Status handler registered for EM:0 updates and network changes");
