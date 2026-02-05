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

function validateCurrent(value) {
  // Return 0 if value is invalid (NaN, negative, or not a number)
  if (value === undefined || typeof value !== "number" || isNaN(value) || value < 0) {
    return false;
  }
  return true;
}

function logPhaseMeasurements(emData) {
  let measurements = [];

  for (let phaseName in CONFIG.PHASES) {
    let phaseConfig = CONFIG.PHASES[phaseName];
    let phaseState = state.phases[phaseName];
    let rawCurrent = emData[phaseConfig.emField];
    let valide = validateCurrent(rawCurrent);
    let textCurrent = (valide) ? rawCurrent.toFixed(2) : "?";

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
    let measurement = indicator + phaseName + "=" + textCurrent + "A(" + relayState;

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

function sendCommand(relayIndex, action, onComplete) {
  // Send real command via RPC API if PRO3_IP is configured
  if (!CONFIG.PRO3_IP){
    if (onComplete) onComplete("unknown");
    return;
  }

  // Check if Pro 3 is online before sending command
  if (!state.pro3.online) {
    logError("Cannot send command to " + relayIndex + " - Pro 3 is OFFLINE");
    if (onComplete) onComplete("unknown");
    return;
  }

  let isOn = (action === "on");
  let url = buildRpcUrl("Switch.Set", "id=" + relayIndex + "&on=" + isOn);

  Shelly.call("HTTP.GET", buildHttpGetParams(url), function(result, error_code, error_message) {
    if (error_code !== 0 || !result || result.code !== 200) {
      let errorReason = error_code !== 0 ? error_message : "HTTP " + (result ? result.code : "no response");
      logError("Relay command " + relayIndex + ": " + errorReason);
      if (onComplete) onComplete("unknown");
    } else {
      log("Command sent: " + relayIndex + " -> " + action);
      if (onComplete) onComplete(isOn ? "on" : "off");
    }
    return;
  });
}

function sendHeartbeat(onComplete) {
  if (!CONFIG.PRO3_IP){
    if (onComplete) onComplete({success: false, errorCode: "not_configured", data: {}});
    return;
  }

  if (!state.ethernetConnected) {
    if (onComplete) onComplete({success: false, errorCode: "ethernet_not_connected", data: {}});
    return;
  }

  if (state.heartbeatInProgress) {
    if (onComplete) onComplete({success: false, errorCode: "already_in_progress", data: {}});
    return;
  }

  state.heartbeatInProgress = true;

  let safetyTimeout = CONFIG.HTTP_TIMEOUT * 2;
  let safetyTimer = Timer.set(safetyTimeout, false, function() {
    if (state.heartbeatInProgress) {
      state.heartbeatInProgress = false;
      if (onComplete) onComplete({success: false, errorCode: "safety_timeout", data: {}});
      return;
    }
  });

  let url = "http://" + CONFIG.PRO3_IP + "/script/" + CONFIG.PRO3_SCRIPT_ID + "/heartbeat";
  Shelly.call("HTTP.GET", buildHttpGetParams(url), function(result, error_code, error_message) { 
    Timer.clear(safetyTimer);

    if (error_code !== 0 || !result || result.code !== 200) {
      let errorReason = error_code !== 0 ? error_message : "HTTP " + (result ? result.code : "no_response");
      if (onComplete) onComplete({success: false, errorCode: errorReason, data: {}});
    }else{
      let parsedBody = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
      if (parsedBody) {
        if (onComplete) onComplete({success: true, errorCode: null, data: parsedBody});
      }
    }

    state.heartbeatInProgress = false;
    return;
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
// ACTIONS
// ============================================================================

function powerOnRelay(phaseName, callback){
  let phaseState = state.phases[phaseName];
  let relayIndex = CONFIG.PHASES[phaseName].relayIndex;

  if(phaseState.relay_status === "on"){
    if (callback) callback();
    return;
  }
  
  log("ACTION: " + phaseName + " -> ON");

  if (CONFIG.DRY_RUN) {
    phaseState.relay_status = "on";
    log("DRY_RUN: Would send ON to " + phaseName + " (relay " + relayIndex + ")");
    if (callback) callback();
    return;
  }else{
    sendCommand(relayIndex, "on", function(result){
      phaseState.relay_status = result;
      if (callback) callback();
      return;
    });
  }
}

function powerOffRelay(phaseName, callback){
  let phaseState = state.phases[phaseName];
  let relayIndex = CONFIG.PHASES[phaseName].relayIndex;

  if(phaseState.relay_status === "off"){
    if (callback) callback();
    return;
  }

  log("ACTION: " + phaseName + " -> OFF");

  if (CONFIG.DRY_RUN) {
    phaseState.relay_status = "off";
    log("DRY_RUN: Would send OFF to " + phaseName + " (relay " + relayIndex + ")");
    if (callback) callback();
    return;
  }else{
    sendCommand(relayIndex, "off", function(result){
      phaseState.relay_status = result;
      if (callback) callback();
      return;
    });
  }
}

function startShedding(phaseName, sheddingType){
  let phaseState = state.phases[phaseName];

  if(!phaseState.active) return;

  powerOffRelay(phaseName, function(){
    if(sheddingType === "immediate"){
      log("IMMEDIATE SHEDDING " + phaseName + " (overload > " + (CONFIG.IMMEDIATE_SHEDDING_MULTIPLIER * 100) + "%)");
    }else if(sheddingType === "normal"){
      let overloadDuration = Date.now() - phaseState.overloadStartTime;
      log("SHEDDING " + phaseName + " (overload for " + (overloadDuration/1000).toFixed(1) + "s)");
    }

    phaseState.active = false;
    phaseState.lastShedding = Date.now();
    phaseState.sheddingCount++;

    publishEvent(phaseName, sheddingType + "_shedding", phaseState.current);
    publishPhaseState(phaseName);
    saveStatsToKV();
  });
}

function stopShedding(phaseName){
  let phaseState = state.phases[phaseName];
  
  if(phaseState.active) return;

  powerOnRelay(phaseName, function(){
    log("RESTORATION " + phaseName + " (delay " + (CONFIG.RESTORATION_DELAY/1000) + "s elapsed)");

    phaseState.active = true;

    publishEvent(phaseName, "restoration", phaseState.current);
    publishPhaseState(phaseName);
  });
}

function startOverload(phaseName){
  let phaseState = state.phases[phaseName];
  
  if(phaseState.overload) return;

  log("OVERLOAD detected " + phaseName + ": " + phaseState.current.toFixed(2) + "A > " + CONFIG.SHEDDING_THRESHOLD + "A");

  phaseState.overload = true;
  phaseState.overloadStartTime = Date.now();

  publishEvent(phaseName, "overload", phaseState.current);
  publishPhaseState(phaseName);
}

function stopOverload(phaseName){
  let phaseState = state.phases[phaseName];
  
  if(!phaseState.overload) return;

  log("CANCEL overload tracking " + phaseName + " (current back to normal)");

  phaseState.overload = false;
  phaseState.overloadStartTime = null;

  publishPhaseState(phaseName);
}

function pro3NowOnline(){
  if(state.pro3.online) return;
  
  log("Pro 3 is now ONLINE - triggering relay synchronization");

  syncRelayStates();

  state.pro3.online = true;
  state.pro3.consecutiveFailures = 0;
}

function pro3NowOffline(){
  if(!state.pro3.online) return;

  logError("Pro 3 is now OFFLINE");

  // Reset relay_status to unknown for all phases
  for (let phaseName in state.phases) {
    state.phases[phaseName].relay_status = "unknown";
  }

  state.pro3.online = false;
}

function syncRelayStates() {
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

      if(desiredState){
        powerOnRelay(phaseName, function(){
          publishPhaseState(phaseName);
          syncNext();
        });
      }else{
        powerOffRelay(phaseName, function(){
          publishPhaseState(phaseName);
          syncNext();
        });
      }

    } else {
      log("SYNC: " + phaseName + " is in sync (" + (actualState ? "ON" : "OFF") + ")");
      syncNext();
    }
  }

  syncNext();
}


// ============================================================================
// SHEDDING LOGIC
// ============================================================================

function computeSheddingDecision(active, current, overloadStartTime, lastShedding) {
  let result = {
    needShedding: false,
    needRestoration: false,
    sheddingType: "",
  }
  let now = Date.now();

  // ---- OVERLOAD DETECTION ----
  if (current > CONFIG.SHEDDING_THRESHOLD) {
    if (!active) return result;

    let overloadDuration = now - overloadStartTime;
    if (current > CONFIG.SHEDDING_THRESHOLD * CONFIG.IMMEDIATE_SHEDDING_MULTIPLIER) {
      // Immediate shedding if well above threshold
      result.needShedding = true;
      result.sheddingType = "immediate";
    } else if (overloadDuration >= CONFIG.SHEDDING_DELAY) {
      // Normal shedding after delay
      result.needShedding = true;
      result.sheddingType = "normal";
    }
  }
  // ---- NO OVERLOAD ----
  else {
    // ---- RESTORATION CHECK ----
    if (!active) {
      // Relay is OFF (SHED) - check for restoration
      if (current < CONFIG.RESTORATION_THRESHOLD) {
        let elapsed = now - lastShedding;

        if (elapsed >= CONFIG.RESTORATION_DELAY) {
          result.needRestoration = true;
        }
      }
    }
  }

  return result;
}

function computeOverloadingDecision(overload, current){
  let result = {
    needOverload: false,
    needEndOfOverload: false,
  }

  if(!overload && current > CONFIG.SHEDDING_THRESHOLD){
    result.needOverload = true;
  }else if (overload && current <= CONFIG.SHEDDING_THRESHOLD){
    result.needEndOfOverload = true;
  }
  return result;
}

// ============================================================================
// HANDLERS
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
    let valide = validateCurrent(rawCurrent);
    if(valide) {
      let phaseState = state.phases[phaseName];
      phaseState.current = rawCurrent;

      //COMPUTE OVERLOAD
      let overloadDecision = computeOverloadingDecision(phaseState.overload, rawCurrent);
      if (overloadDecision.needOverload){        
        startOverload(phaseName);
      }else if (overloadDecision.needEndOfOverload){
        stopOverload(phaseName);
      }

      //COMPUTE DECISION
      let sheedingDecision = computeSheddingDecision(phaseState.active, rawCurrent, phaseState.overloadStartTime, phaseState.lastShedding);
      if (sheedingDecision.needShedding){        
        startShedding(phaseName, sheedingDecision.sheddingType);
      }else if (sheedingDecision.needRestoration){
        stopShedding(phaseName);
      }
    }else{
      logError("Invalid current value for " + phaseName + ": " + rawCurrent);
    }
  }

  // Log measurements
  logPhaseMeasurements(emData);
}

function handleETHStatusUpdate(msg) {
  // Only process EM status updates (ignore other component updates)
  if (!msg || !msg.component || msg.component !== "eth") return;

  // Use delta if available, otherwise use full info
  let ethData = msg.delta || msg.info;
  if (!ethData) return;
  if (ethData.ip == undefined) return;

  let wasConnected = state.ethernetConnected;
  let isConnected = ethData.ip !== null;

  if (isConnected !== wasConnected) {
    state.ethernetConnected = isConnected;

    if (isConnected) {
      log("🌐 Ethernet CONNECTED");
      startHeartbeat();
    } else {
      log("🌐 Ethernet DISCONNECTED");
      pro3NowOffline();
      stopHeartbeat();
    }
  }
}

function handleHeartbeat() {
  sendHeartbeat(function(result){
    if(!result.success){
      if(result.errorCode === "not_configured" || result.errorCode === "already_in_progress")
        return;

      state.pro3.consecutiveFailures++;

      if(result.errorCode === "ethernet_not_connected"){
        logError("Cannot send heartbeat - ETH disconected");
      }else if(result.errorCode === "safety_timeout"){
        logError("Heartbeat safety timeout triggered - callback never called");
      }else {
        logError("Heartbeat failed (" + state.pro3.consecutiveFailures + "/" + CONFIG.MAX_CONSECUTIVE_FAILURES + "): " + result.errorCode);
      }

      if (state.pro3.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES && state.pro3.online) {
        pro3NowOffline();
      }
      return;
    }
    else{
      if (result.data.version) {
        state.pro3.version = result.data.version;
      }
      if (result.data.relays) {
        for (let phaseName in CONFIG.PHASES) {
          let relayKey = "relay" + CONFIG.PHASES[phaseName].relayIndex;
          if (result.data.relays[relayKey] !== undefined) {
            state.phases[phaseName].relay_status = result.data.relays[relayKey] ? "on" : "off";
          }
        }
      }
      if (!state.pro3.online) {
        pro3NowOnline();
      }
    }

    publishRegularStates();
  });
}

// ============================================================================
// STARTUP
// ============================================================================

function startHeartbeat() {
  if (state.heartbeatTimerId !== null) return;

  handleHeartbeat();
  state.heartbeatTimerId = Timer.set(CONFIG.HEARTBEAT_INTERVAL, true, handleHeartbeat);
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
    handleETHStatusUpdate(msg);
  });
  log("Status handler registered for EM:0 updates and network changes");
});
