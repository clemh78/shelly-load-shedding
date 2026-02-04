/******************************************************************************
 * INTELLIGENT THREE-PHASE LOAD SHEDDING - Pro 3EM
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
  // Script version
  VERSION: "1.7",

  // Network addresses (leave empty for simulation mode)
  PRO3_IP: "192.168.1.103",                // Set to Pro 3EM IP (e.g., "10.0.0.101") or leave empty for simulation
  PRO3_SCRIPT_ID: 1,                       // Script ID on Pro 3 (HTTPServer endpoint is /script/{ID}/heartbeat)

  // ⚡ PHASE CONFIGURATION
  PHASES: {
    L1: { relayIndex: 0, emField: "a_current" },
    L2: { relayIndex: 1, emField: "b_current" },
    L3: { relayIndex: 2, emField: "c_current" }
  },

  // ⚡ THRESHOLDS (applied to all phases)
  SHEDDING_THRESHOLD: 28,              // Shed above this (A) - 2A margin (93% of rating)
  RESTORATION_THRESHOLD: 26,           // Restore below this (A) - 2A hysteresis
  IMMEDIATE_SHEDDING_MULTIPLIER: 1.2,  // Immediate shedding at 120% of threshold

  // Timings
  SHEDDING_DELAY: 2000,         // 2s delay before shedding (circuit breaker tolerates peaks)
  RESTORATION_DELAY: 300000,    // 5min (300s) before restoring

  // Debug mode
  DEBUG: true,
  DEBUG_MQTT: false,                // Enable verbose MQTT logs (separate from DEBUG)
  DRY_RUN: true,                   // Dry run mode: heartbeat works but relay commands are simulated

  // 📡 MQTT
  MQTT_ENABLED: true,         // Enable MQTT publishing
  // MQTT_TOPIC_PREFIX: "load-shedding-14335cc56020",  // MQTT topic prefix
  MQTT_TOPIC_PREFIX: "load-shedding-dev",  // MQTT topic prefix for dev

  // 🔌 PRO 3 CONNECTION
  // CRITICAL: Pro3EM must detect offline BEFORE Pro3 triggers emergency shutdown
  // Pro3EM detection time: ~15s (HEARTBEAT_INTERVAL + HTTP_TIMEOUT)
  // Pro3 emergency trigger: 30s (see HEARTBEAT_TIMEOUT in pro3.js)
  // Safety margin: ~15s
  HEARTBEAT_INTERVAL: 10000,        // Heartbeat check every 10s
  MAX_CONSECUTIVE_FAILURES: 1,      // Mark offline after 1 failed heartbeat
  HTTP_TIMEOUT: 5000,               // HTTP request timeout (5s)

  KV_STATS_KEY: "shedding_stats"
};

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

let state = {
  phases: {},                       // Initialized by init()
  pro3: {                           // Pre-initialized to avoid race conditions at startup
    online: false,
    consecutiveFailures: 0,
    version: null
  },
  heartbeatInProgress: false,       // Guard to prevent concurrent heartbeats
  heartbeatTimerId: null,           // ID of periodic heartbeat timer (to stop/restart it)
  ethernetConnected: false          // Ethernet connection state
};

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

function logPhaseMeasurements(emData) {
  let measurements = [];

  for (let phaseName in CONFIG.PHASES) {
    let phaseConfig = CONFIG.PHASES[phaseName];
    let phaseState = state.phases[phaseName];
    let rawCurrent = emData[phaseConfig.emField];
    let current = validateCurrent(rawCurrent !== undefined ? rawCurrent : 0, phaseName);

    // Status indicator based on phase state (using booleans)
    let indicator;
    if (!phaseState.active) {
      indicator = "[SHED]";
    } else if (phaseState.overload) {
      indicator = "[WARN]";
    } else {
      indicator = "[OK]";
    }

    // Build measurement with relay state
    let relayState = phaseState.active ? "ON" : "OFF";
    let measurement = indicator + phaseName + "=" + current.toFixed(2) + "A(" + relayState;

    // Add restoration countdown if phase is shed
    if (!phaseState.active && phaseState.lastShedding) {
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

// ============================================================================
// INITIALIZATION
// ============================================================================

function init(callback) {
  // Initialize phase states from CONFIG.PHASES
  for (let phaseName in CONFIG.PHASES) {
    state.phases[phaseName] = {
      active: true,                  // true = ON, false = OFF
      relay_status: "unknown",      // Actual relay state from Pro 3 heartbeat ("on", "off", "unknown")
      current: 0,                   // Last measured current (A)
      overload: false,              // true = current > SHEDDING_THRESHOLD
      overloadStartTime: null,      // Timestamp when overload started (null = no overload)
      lastShedding: 0,              // Timestamp of last shedding
      sheddingCount: 0              // Total number of sheddings (persisted in KV)
    };
  }

  // 📦 Load persisted stats from KV store, then continue startup
  loadStatsFromKV(initEthernetState(callback));
}

function initEthernetState(callback) {
  if (CONFIG.PRO3_IP) {
    // Check Ethernet status before starting heartbeat
    Shelly.call("Eth.GetStatus", {}, function(result, error_code) {
      if (error_code === 0 && result && result.ip !== null) {
        // Ethernet is connected - start heartbeat
        state.ethernetConnected = true;
        log("Ethernet connected.");
      } else {
        // Ethernet not connected - heartbeat will start when connection detected
        state.ethernetConnected = false;
        log("Ethernet not connected.");
      }
      if (callback) callback();
    });
  }
}

// ============================================================================
// KV STORE FUNCTIONS (Persistence)
// ============================================================================

function loadStatsFromKV(callback) {
  Shelly.call("KVS.Get", { key: CONFIG.KV_STATS_KEY }, function(result, error_code) {
    if (error_code === 0 && result && result.value) {
      let stats = JSON.parse(result.value);
      log("KV: Loaded stats from storage");

      // Restore stats for each phase
      for (let phaseName in stats) {
        if (state.phases[phaseName]) {
          if (stats[phaseName].sheddingCount !== undefined) {
            state.phases[phaseName].sheddingCount = stats[phaseName].sheddingCount;
          }
          if (stats[phaseName].lastShedding !== undefined) {
            state.phases[phaseName].lastShedding = stats[phaseName].lastShedding;
          }
          log("KV: " + phaseName + " - count=" + state.phases[phaseName].sheddingCount +
              ", lastShedding=" + (state.phases[phaseName].lastShedding || "never"));
        }
      }
    } else {
      log("KV: No saved stats found (first run or reset)");
    }
    if (callback) callback();
  });
}

function saveStatsToKV(callback) {
  let stats = {};
  for (let phaseName in state.phases) {
    stats[phaseName] = {
      sheddingCount: state.phases[phaseName].sheddingCount,
      lastShedding: state.phases[phaseName].lastShedding
    };
  }

  Shelly.call("KVS.Set", { key: CONFIG.KV_STATS_KEY, value: JSON.stringify(stats) }, function(result, error_code) {
    if (error_code === 0) {
      log("KV: Stats saved to storage");
      if (callback) callback(true);
    } else {
      logError("KV: Failed to save stats");
      if (callback) callback(false);
    }
  });
}

// ============================================================================
// RELAY COMMAND
// ============================================================================

function sendCommand(phaseName, action, onComplete) {
  let isOn = (action === "on");

  // Log action
  log("ACTION: " + phaseName + " -> " + action.toUpperCase());

  // DRY_RUN mode: simulate command without sending to relay
  if (CONFIG.DRY_RUN) {
    state.phases[phaseName].relay_status = isOn ? "on" : "off";
    log("DRY_RUN: Would send " + action + " to " + phaseName + " (relay " + CONFIG.PHASES[phaseName].relayIndex + ")");
    if (onComplete) onComplete();
    return;
  }

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
        state.phases[phaseName].relay_status = "unknown";
      } else {
        state.phases[phaseName].relay_status = isOn ? "on" : "off";
        log("Command sent: " + phaseName + " -> " + action);
      }
      if (onComplete) onComplete();
    });
  } else {
    state.phases[phaseName].relay_status = isOn ? "on" : "off";
    log("SIMULATION: Would send " + action + " to " + phaseName);
    if (onComplete) onComplete();
  }
}

function syncRelayStates() {
  if (!CONFIG.PRO3_IP) {
    return;
  }

  log("SYNC: Starting relay synchronization...");

  let phaseNames = Object.keys(CONFIG.PHASES);
  let index = 0;

  function syncNext() {
    if (index >= phaseNames.length) {
      log("SYNC: Completed");
      return;
    }

    let phaseName = phaseNames[index];
    let phaseState = state.phases[phaseName];
    let desiredState = phaseState.active;
    index++;

    if (phaseState.relay_status === "unknown") {
      logError("SYNC: " + phaseName + " relay_status unknown, skipping");
      syncNext();
      return;
    }

    let actualState = phaseState.relay_status === "on";

    if (actualState !== desiredState) {
      log("SYNC: " + phaseName + " mismatch - actual: " + (actualState ? "ON" : "OFF") + ", desired: " + (desiredState ? "ON" : "OFF"));
      sendCommand(phaseName, desiredState ? "on" : "off", syncNext);
      publishPhaseState(phaseName);
    } else {
      log("SYNC: " + phaseName + " is in sync (" + (actualState ? "ON" : "OFF") + ")");
      syncNext();
    }
  }

  syncNext();
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

  // Call Pro3's HTTPServer endpoint /heartbeat
  let url = "http://" + CONFIG.PRO3_IP + "/script/" + CONFIG.PRO3_SCRIPT_ID + "/heartbeat";

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

        // Reset relay_status to unknown for all phases
        for (let phaseName in state.phases) {
          state.phases[phaseName].relay_status = "unknown";
        }
        publishRegularStates();
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

        // Reset relay_status to unknown for all phases
        for (let phaseName in state.phases) {
          state.phases[phaseName].relay_status = "unknown";
        }
      }
    } else {
      // Heartbeat succeeded = Pro 3 is online
      state.pro3.consecutiveFailures = 0;

      // Update relay_status from heartbeat response
      let parsedBody = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
      if (parsedBody) {
        // Store Pro 3 script version
        if (parsedBody.version) {
          state.pro3.version = parsedBody.version;
        }

        // Update relay states
        if (parsedBody.relays) {
          for (let phaseName in CONFIG.PHASES) {
            let relayKey = "relay" + CONFIG.PHASES[phaseName].relayIndex;
            if (parsedBody.relays[relayKey] !== undefined) {
              state.phases[phaseName].relay_status = parsedBody.relays[relayKey] ? "on" : "off";
            }
          }
        }
      }

      if (!wasOnline) {
        // Was offline, now online (reconnection or first connection at startup)
        state.pro3.online = true;
        log("Pro 3 is now ONLINE - triggering relay synchronization");

        syncRelayStates();
      }
      // else: already online, everything ok (no action needed)
    }

    // Publish states after every heartbeat (success or failure)
    publishRegularStates();

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

function publishPhaseState(phaseName) {
  let phaseState = state.phases[phaseName];
  let msg = createRPCMessage("NotifyState", {
    phase: phaseName,
    overload: phaseState.overload,
    shedding: !phaseState.active,
    relay_status: phaseState.relay_status,
    current: phaseState.current,
    last_shedding: phaseState.lastShedding || null,
    shedding_count: phaseState.sheddingCount
  });

  publishMQTT(phaseName + "/state", msg, true);
}

function publishEvent(phaseName, action, current) {
  let msg = createRPCMessage("NotifyEvent", {
    phase: phaseName,
    relay: CONFIG.PHASES[phaseName].relayIndex,
    action: action,
    current: current ? current.toFixed(2) : null
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
    publishPhaseState(phaseName);

    // Add to global status
    let phaseKey = phaseName.toLowerCase();
    statusData[phaseKey + "_overload"] = phaseState.overload;
    statusData[phaseKey + "_shedding"] = !phaseState.active;
    statusData[phaseKey + "_relay_status"] = phaseState.relay_status;
    statusData[phaseKey + "_current"] = phaseState.current;
    statusData[phaseKey + "_last_shedding"] = phaseState.lastShedding || null;
    statusData[phaseKey + "_shedding_count"] = phaseState.sheddingCount;
  }

  // Add Pro 3 online status, versions, and global thresholds
  statusData.pro3_online = state.pro3.online;
  statusData.pro3_version = state.pro3.version;
  statusData.pro3em_version = CONFIG.VERSION;
  statusData.shedding_threshold = CONFIG.SHEDDING_THRESHOLD;
  statusData.restoration_threshold = CONFIG.RESTORATION_THRESHOLD;

  // Publish global status
  let msg = createRPCMessage("NotifyStatus", statusData);
  publishMQTT("status", msg, true);

  logMQTT("Regular states published");
}

// ============================================================================
// SHEDDING LOGIC
// ============================================================================

function checkPhase(phaseName, current) {
  let now = Date.now();
  let phaseState = state.phases[phaseName];

  // Update current measurement
  phaseState.current = current;
  phaseState.overload = current > CONFIG.SHEDDING_THRESHOLD;

  // ---- OVERLOAD DETECTION ----
  if (current > CONFIG.SHEDDING_THRESHOLD) {
    // Start tracking overload time if not already tracking
    if (phaseState.overloadStartTime === null) {
      phaseState.overloadStartTime = now;
      log("OVERLOAD detected " + phaseName + ": " + current.toFixed(2) + "A > " + CONFIG.SHEDDING_THRESHOLD + "A");
    }

    // Only shed if relay is still ON
    if (!phaseState.active) return;

    let overloadDuration = now - phaseState.overloadStartTime;

    // Check if shedding is needed
    let shouldShed = false;
    let sheddingType = "";

    if (current > CONFIG.SHEDDING_THRESHOLD * CONFIG.IMMEDIATE_SHEDDING_MULTIPLIER) {
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
      phaseState.active = false;
      phaseState.lastShedding = now;
      phaseState.sheddingCount++;

      // Persist stats to KV store
      saveStatsToKV();

      publishPhaseState(phaseName);
      publishEvent(phaseName, sheddingType + "_shedding", current);
    }
  }
  // ---- NO OVERLOAD ----
  else {
    // Reset overload tracking only if relay is ON
    if (phaseState.overloadStartTime !== null && phaseState.active) {
      log("CANCEL overload tracking " + phaseName + " (current back to normal)");
      phaseState.overloadStartTime = null;
    }

    // ---- RESTORATION CHECK ----
    if (!phaseState.active) {
      // Relay is OFF (SHED) - check for restoration
      if (current < CONFIG.RESTORATION_THRESHOLD) {
        let elapsed = now - phaseState.lastShedding;

        if (elapsed >= CONFIG.RESTORATION_DELAY) {
          log("RESTORATION " + phaseName + " (delay " + (CONFIG.RESTORATION_DELAY/1000) + "s elapsed)");
          sendCommand(phaseName, "on");
          phaseState.active = true;
          phaseState.overloadStartTime = null;

          publishPhaseState(phaseName);
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

function handleETHStatusUpdate(msg) {
  // Only process EM status updates (ignore other component updates)
  if (!msg || !msg.component || msg.component !== "eth") return;

  // Use delta if available, otherwise use full info
  let emData = msg.delta || msg.info;
  if (!emData) return;
  if (ethData.ip == undefined) return;

  let wasConnected = state.ethernetConnected;
  let isConnected = ethData.ip !== null;

  if (isConnected !== wasConnected) {
    state.ethernetConnected = isConnected;

    if (isConnected) {
      log("🌐 Ethernet CONNECTED");
      state.pro3.consecutiveFailures = 0;
      startHeartbeat();
    } else {
      log("🌐 Ethernet DISCONNECTED");
      stopHeartbeat();

      // Pro 3 is unreachable without network - mark offline
      if (state.pro3.online) {
        state.pro3.online = false;
        logError("Pro 3 is now OFFLINE (no network)");

        // Reset relay_status to unknown for all phases
        for (let phaseName in state.phases) {
          state.phases[phaseName].relay_status = "unknown";
        }
        publishRegularStates();
      }
    }
  }
}

// ============================================================================
// STARTUP
// ============================================================================

function startHeartbeat() {
  if (state.heartbeatTimerId !== null) return;

  sendHeartbeat();
  state.heartbeatTimerId = Timer.set(CONFIG.HEARTBEAT_INTERVAL, true, sendHeartbeat);
  log("HTTP heartbeat started (every " + (CONFIG.HEARTBEAT_INTERVAL/1000) + "s)");

  if (CONFIG.MQTT_ENABLED) {
    publishRegularStates();
  }
}

function stopHeartbeat() {
  if (state.heartbeatTimerId === null) return;

  Timer.clear(state.heartbeatTimerId);
  state.heartbeatTimerId = null;
}

init(function() {
  if(state.ethernetConnected){
    startHeartbeat();
  }

  Shelly.addStatusHandler(function(msg) {
    handleEMStatusUpdate(msg);
    handleETHStatusUpdate(mqg);
  });
  log("Status handler registered for EM:0 updates and network changes");
});
