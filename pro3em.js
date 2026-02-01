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
  VERSION: "1.5",

  // Network addresses (leave empty for simulation mode)
  PRO3_IP: "192.168.1.103",                // Set to Pro 3EM IP (e.g., "10.0.0.101") or leave empty for simulation
  PRO3_SCRIPT_ID: 1,                       // Script ID on Pro 3 (HTTPServer endpoint is /script/{ID}/heartbeat)

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

  // 🔌 PRO 3 CONNECTION
  // CRITICAL: Pro3EM must detect offline BEFORE Pro3 triggers emergency shutdown
  // Pro3EM detection time: ~15s (HEARTBEAT_INTERVAL + HTTP_TIMEOUT)
  // Pro3 emergency trigger: 30s (see HEARTBEAT_TIMEOUT in pro3.js)
  // Safety margin: ~15s
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
      active: true,                  // true = ON, false = OFF
      relay_status: "unknown",      // Actual relay state from Pro 3 heartbeat ("on", "off", "unknown")
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
      if (parsedBody && parsedBody.relays) {
        for (let phaseName in CONFIG.PHASES) {
          let relayKey = "relay" + CONFIG.PHASES[phaseName].relayIndex;
          if (parsedBody.relays[relayKey] !== undefined) {
            state.phases[phaseName].relay_status = parsedBody.relays[relayKey] ? "on" : "off";
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
    active: phaseState.active,
    relay_status: phaseState.relay_status,
    current: phaseState.current,
    status: phaseState.status,
    last_shedding: phaseState.lastShedding || null
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
    publishPhaseState(phaseName);

    // Add to global status
    let phaseKey = phaseName.toLowerCase();
    statusData[phaseKey + "_active"] = phaseState.active;
    statusData[phaseKey + "_relay_status"] = phaseState.relay_status;
    statusData[phaseKey + "_current"] = phaseState.current;
    statusData[phaseKey + "_status"] = phaseState.status;
    statusData[phaseKey + "_last_shedding"] = phaseState.lastShedding || null;
  }

  // Add Pro 3 online status
  statusData.pro3_online = state.pro3.online;

  // Publish global status
  let msg = createRPCMessage("NotifyStatus", statusData);
  publishMQTT("status", msg, true);

  logMQTT("Regular states published");
}

// Home Assistant Auto-Discovery Configuration
function publishHADiscovery(topic, config) {
  if (!CONFIG.MQTT_ENABLED) return;
  MQTT.publish("homeassistant/" + topic, JSON.stringify(config), 0, true);
}

function publishHomeAssistantDiscovery() {
  let deviceInfo = {
    identifiers: ["load_shedder_" + Shelly.getDeviceInfo().id],
    name: "Load Shedder",
    model: "Custom Shelly",
    manufacturer: "DIY",
    sw_version: CONFIG.VERSION
  };

  let prefix = CONFIG.MQTT_TOPIC_PREFIX;
  let onlineTopic = Shelly.getDeviceInfo().id + "/online";

  for (let phaseName in CONFIG.PHASES) {
    let phaseKey = phaseName.toLowerCase();
    let stateTopic = prefix + "/" + phaseName + "/state";

    // 1. Binary sensor for shedding state
    publishHADiscovery("binary_sensor/load_shedder/" + phaseKey + "_active/config", {
      name: phaseName + " Shedding",
      unique_id: "load_shedder_active_" + phaseKey,
      state_topic: stateTopic,
      value_template: "{{ not value_json.params.data.active }}",
      payload_on: "True",
      payload_off: "False",
      device_class: "problem",
      device: deviceInfo,
      availability_topic: onlineTopic,
      payload_available: "true",
      payload_not_available: "false"
    });

    // 2. Sensor for current (A)
    publishHADiscovery("sensor/load_shedder/" + phaseKey + "_current/config", {
      name: phaseName + " Current",
      unique_id: "load_shedder_current_" + phaseKey,
      state_topic: stateTopic,
      value_template: "{{ value_json.params.data.current }}",
      unit_of_measurement: "A",
      device_class: "current",
      state_class: "measurement",
      expire_after: 30,
      device: deviceInfo
    });

    // 3. Sensor for status
    publishHADiscovery("sensor/load_shedder/" + phaseKey + "_status/config", {
      name: phaseName + " Status",
      unique_id: "load_shedder_status_" + phaseKey,
      state_topic: stateTopic,
      value_template: "{{ value_json.params.data.status }}",
      icon: "mdi:state-machine",
      expire_after: 30,
      device: deviceInfo
    });

    // 4. Sensor for last shedding timestamp
    publishHADiscovery("sensor/load_shedder/" + phaseKey + "_last_shedding/config", {
      name: phaseName + " Last Shedding",
      unique_id: "load_shedder_last_shedding_" + phaseKey,
      state_topic: stateTopic,
      value_template: "{% set ts = value_json.params.data.last_shedding %}{{ (ts / 1000) | timestamp_utc if ts else None }}",
      device_class: "timestamp",
      device: deviceInfo
    });

    // 5. Binary sensor for physical relay state
    publishHADiscovery("binary_sensor/load_shedder/" + phaseKey + "_relay/config", {
      name: phaseName + " Relay",
      unique_id: "load_shedder_relay_status_" + phaseKey,
      state_topic: stateTopic,
      value_template: "{{ value_json.params.data.relay_status }}",
      payload_on: "on",
      payload_off: "off",
      device_class: "power",
      device: deviceInfo,
      availability_topic: prefix + "/status",
      availability_template: "{{ 'online' if value_json.params.data.pro3_online else 'offline' }}"
    });
  }

  // 5. Binary sensor for Pro 3 online status
  publishHADiscovery("binary_sensor/load_shedder/pro3_online/config", {
    name: "Pro3 Online",
    unique_id: "load_shedder_pro3_online",
    state_topic: prefix + "/status",
    value_template: "{{ value_json.params.data.pro3_online | tojson }}",
    payload_on: "true",
    payload_off: "false",
    device_class: "connectivity",
    device: deviceInfo
  });

  log("Home Assistant auto-discovery published");
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
    let relayState = phaseState.active ? "ON" : "OFF";
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
    if (!phaseState.active) return;

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
      phaseState.active = false;
      phaseState.lastShedding = now;
      phaseState.status = "SHED";

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

    // ---- STATUS UPDATE OR RESTORATION ----
    if (phaseState.active) {
      // Relay is ON - update status based on current level
      phaseState.status = current < phaseConfig.restorationThreshold ? "NORMAL" : "WARNING";
    } else {
      // Relay is OFF (SHED) - check for restoration
      if (current < phaseConfig.restorationThreshold) {
        let elapsed = now - phaseState.lastShedding;

        if (elapsed >= CONFIG.RESTORATION_DELAY) {
          log("RESTORATION " + phaseName + " (delay " + (CONFIG.RESTORATION_DELAY/1000) + "s elapsed)");
          sendCommand(phaseName, "on");
          phaseState.active = true;
          phaseState.status = "NORMAL";
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
  publishHomeAssistantDiscovery();
  publishRegularStates();
  logMQTT("Initial states published");
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

            // Reset relay_status to unknown for all phases
            for (let phaseName in state.phases) {
              state.phases[phaseName].relay_status = "unknown";
            }
            publishRegularStates();
          }
        }
      }
    }
  }
});
log("Status handler registered for EM:0 updates and network changes");
