/******************************************************************************
 * PRO 3 SAFETY PROTECTION SCRIPT
 * Author: Clément
 *
 * Installation: Shelly Pro 3 → Settings → Scripts → Add Script
 * IP: 10.0.0.101
 *
 * 🛡️ PROTECTION: Emergency shutdown if Pro 3EM heartbeat is lost
 *
 * How it works:
 * - Pro 3 exposes HTTP endpoint /heartbeat via HTTPServer
 * - Pro 3EM calls this endpoint every 10 seconds
 * - Pro 3 monitors last heartbeat timestamp
 * - If no heartbeat for 60s → cut all relays (emergency shutdown)
 * - When heartbeat resumes → log recovery (Pro 3EM will restore relays)
 ******************************************************************************/

// ============================================================================
// CONFIGURATION
// ============================================================================

let CONFIG = {
  // Script version
  VERSION: "2.0",

  // 🔒 SAFETY SETTINGS
  // CRITICAL: Pro3EM must detect offline BEFORE Pro3 triggers emergency shutdown
  // Pro3EM detection time: ~15s (see HEARTBEAT_INTERVAL + HTTP_TIMEOUT in pro3em.js)
  // Pro3 emergency trigger: 60s (HEARTBEAT_TIMEOUT below)
  // Safety margin: ~45s - ensures Pro3EM marks Pro3 offline and will re-sync when connection restored
  HEARTBEAT_CHECK_INTERVAL: 5000,   // Check for missing heartbeat every 5s
  HEARTBEAT_TIMEOUT: 60000,         // Emergency shutdown if no heartbeat for 60s (6x expected interval from Pro3EM)
  // Debug mode
  DEBUG: true,

  // 🧪 TEST MODE
  TEST_MODE: true,                // Simulates relay operations without touching hardware

  // Relay configuration
  RELAYS: [0, 1, 2],  // Pro 3 has 3 relays
};

// ============================================================================
// GLOBAL STATE
// ============================================================================

let state = {
  // 📡 Pro 3EM Connection & Heartbeat
  heartbeat: {
    online: null,                   // Is Pro 3EM online? (null = unknown, true = online, false = offline)
    lastPing: null,                 // Timestamp of last heartbeat received from Pro3EM (null = never received)
  },

  // 🛡️ Emergency Shutdown Management
  emergencyShutdown: {
    active: false,                  // Are we in emergency shutdown mode?
    activationInProgress: false     // Guard to prevent concurrent emergency shutdowns
  },

  // 🔌 Relay States
  relays: {},                       // Relay states (initialized by init())
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function chainOperations(ids, operation, onComplete) {
  if (ids.length === 0) {
    if (onComplete) Timer.set(0, false, function() { onComplete(); });
    return;
  }

  let id = ids[0];
  let remaining = ids.slice(1);

  operation(id, function() {
    // Use Timer.set for next iteration to prevent deep call stacks
    Timer.set(0, false, function() {
      chainOperations(remaining, operation, onComplete);
    });
  });
}

function log(message) {
  if (CONFIG.DEBUG) {
    print("[PRO3-SAFETY] " + message);
  }
}

function logError(message) {
  print("[PRO3-SAFETY] ERROR: " + message);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function init(callback) {
  // Initialize relay states
  for (let i = 0; i < CONFIG.RELAYS.length; i++) {
    state.relays[CONFIG.RELAYS[i]] = {
      on: null,                     // Relay state (true = ON, false = OFF, null = unknown)
      lastUpdate: 0                 // Timestamp of last update
    };
  }

  fetchRelayStates(callback);
}

// ============================================================================
// RELAY CONTROL
// ============================================================================

function setState(relayId, action, onComplete) {
  if (CONFIG.TEST_MODE){
    if (onComplete) Timer.set(0, false, function() { onComplete(action === "on"); });
    return;
  }

  let isOn = (action === "on");
  Shelly.call("Switch.Set", {id: relayId, on: isOn}, function(result, error_code, error_message) {
    if (error_code !== 0 || !result) {
      let errorReason = error_code !== 0 ? error_message : "Switch.Set " + (result ? result.code : "no response");
      logError("Relay set " + relayId + ": " + errorReason);
      if (onComplete) onComplete(null);
    } else {
      log("Command sent: " + relayId + " -> " + action);
      if (onComplete) onComplete(isOn);
    }
    return;
  });
}

function getRelayStatus(relayId, onComplete){
  if (CONFIG.TEST_MODE){
    if (onComplete) Timer.set(0, false, function() { onComplete(true); });
    return;
  }

  Shelly.call("Switch.GetStatus", {id: relayId}, function(result, error_code, error_message) {
    if (error_code !== 0 || !result || result.output === undefined) {
      let errorReason = error_code !== 0 ? error_message : "Switch.GetStatus " + (result ? result.code : "no response");
      logError("Relay get status " + relayId + ": " + errorReason);
      if (onComplete) onComplete(null);
    } else {
      if (onComplete) onComplete(result.output);
    }
    return;
  });
}

// ============================================================================
// ACTIONS
// ============================================================================

function cutRelay(relayId, onComplete) {
  setState(relayId, "off", function(result){
    if(result !== null){
      state.relays[relayId].on = result;
      state.relays[relayId].lastUpdate = Date.now();
      log("✂️ Relay " + relayId + " cut");
    }
    if (onComplete) onComplete();
  });
}

function fetchRelayState(relayId, onComplete) {
  getRelayStatus(relayId, function(result){
    if(result !== null){
      state.relays[relayId].on = result;
      state.relays[relayId].lastUpdate = Date.now();
      log("Relay " + relayId + " initial state: " + (result ? "ON" : "OFF"));
    }
    if (onComplete) onComplete();
  });
}

function fetchRelayStates(onComplete) {
  log("Fetching initial relay states...");

  chainOperations(CONFIG.RELAYS, fetchRelayState, function() {
    log("Initial relay states fetched");
    if (onComplete) onComplete();
  });
}

function activateEmergencyShutdown() {
  if (state.emergencyShutdown.active) {
    return;
  }

  if (state.emergencyShutdown.activationInProgress) {
    log("Emergency shutdown already in progress, skipping");
    return;
  }

  state.emergencyShutdown.activationInProgress = true;
  logError("🚨 EMERGENCY SHUTDOWN: Pro 3EM heartbeat lost - cutting all relays");

  chainOperations(CONFIG.RELAYS, cutRelay, function() {
    state.emergencyShutdown.activationInProgress = false;

    // Heartbeat resumed while relays were being cut — don't enter emergency mode
    // Pro3EM will resync relays to their correct state
    if (state.heartbeat.online) {
      log("Heartbeat resumed during relay cutting - emergency mode cancelled");
      return;
    }

    state.emergencyShutdown.active = true;
    log("🚨 EMERGENCY SHUTDOWN: Completed relay cutting");
  });
}

function disableEmergencyShutdown() {
  if (!state.emergencyShutdown.active) {
    return;
  }

  if (state.emergencyShutdown.activationInProgress) {
    log("Emergency shutdown in progress, skipping");
    return;
  }

  state.emergencyShutdown.active = false;
}

function heartbeatNowDown(){
  if(!state.heartbeat.online) return;

  log("💔 Pro 3EM is now OFFLINE");

  activateEmergencyShutdown();

  state.heartbeat.online = false;
}

function heartbeatNowUp(){
  if(state.heartbeat.online) return;

  log("✅ Pro 3EM is now ONLINE");

  disableEmergencyShutdown();

  state.heartbeat.online = true;
}

// ============================================================================
// HEARTBEAT LOGIC
// ============================================================================

function computeMonitorDecision(online, lastPing) {

  if(lastPing === null){
    return "waiting_data";
  }

  let elapsed = Date.now() - lastPing;
  if (elapsed > CONFIG.HEARTBEAT_TIMEOUT && online === true) {
    return "down";
  }else if(elapsed <= CONFIG.HEARTBEAT_TIMEOUT && online !== true){
    return "up";
  }

  return null;
}

// ============================================================================
// STATUS HANDLER
// ============================================================================

function handleHeartbeatMonitor() {
  let monitorDecision = computeMonitorDecision(state.heartbeat.online, state.heartbeat.lastPing)

  if (monitorDecision && monitorDecision === "waiting_data"){
    log("Waiting for first heartbeat from Pro3EM...");
  }else if (monitorDecision && monitorDecision === "down"){
    heartbeatNowDown();
  }else if(monitorDecision && monitorDecision === "up"){
    heartbeatNowUp();
  }else{
    let elapsed = Date.now() - state.heartbeat.lastPing;
    if(state.heartbeat.online){
      log("Heartbeat OK (last received " + (elapsed / 1000).toFixed(1) + "s ago)");
    }else{
      log("Heartbeat KO (last received " + (elapsed / 1000).toFixed(1) + "s ago)");
    }
  }
}

function handleHeartbeatRequest(_request, response) {
  let now = Date.now();

  state.heartbeat.lastPing = now;

  // Build response with relay states
  let relayStates = {};
  for (let i = 0; i < CONFIG.RELAYS.length; i++) {
    let relayId = CONFIG.RELAYS[i];
    relayStates["relay" + relayId] = state.relays[relayId].on;
  }

  // Send response
  response.code = 200;
  response.headers = [["Content-Type", "application/json"]];
  response.body = JSON.stringify({
    status: "ok",
    version: CONFIG.VERSION,
    emergency_mode: state.emergencyShutdown.active,
    relays: relayStates
  });
  response.send();

  log("Heartbeat received from Pro3EM");
}

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
  }
}

function startHeartbeatMonitor(){
  handleHeartbeatMonitor();
  Timer.set(CONFIG.HEARTBEAT_CHECK_INTERVAL, true, handleHeartbeatMonitor);
  log("Heartbeat monitoring started (check every " + (CONFIG.HEARTBEAT_CHECK_INTERVAL/1000) + "s, timeout: " + (CONFIG.HEARTBEAT_TIMEOUT/1000) + "s)");
}

// ============================================================================
// TEST MODE HTTP ENDPOINT
// ============================================================================

function setupTestMode() {
  if (!CONFIG.TEST_MODE) return;

  log("🧪 TEST MODE ENABLED - Registering HTTP endpoint for status injection");

  HTTPServer.registerEndpoint("inject-status", function(request, response) {
    try {
      let data = JSON.parse(request.body);

      let msg = {
        component: data.component || "switch:0",
        delta: data.delta || data
      };

      handleStatusUpdate(msg);

      response.code = 200;
      response.headers = [["Content-Type", "application/json"]];
      response.body = JSON.stringify({
        success: true,
        message: "Status injected"
      });
      response.send();

      log("🧪 TEST: Status injected for " + msg.component);
    } catch (error) {
      response.code = 400;
      response.headers = [["Content-Type", "application/json"]];
      response.body = JSON.stringify({
        success: false,
        error: String(error)
      });
      response.send();
      logError("TEST: Failed to inject status: " + String(error));
    }
  });

  HTTPServer.registerEndpoint("get-status", function(_request, response) {
    let relayStates = {};
    for (let i = 0; i < CONFIG.RELAYS.length; i++) {
      let relayId = CONFIG.RELAYS[i];
      relayStates["relay" + relayId] = state.relays[relayId].on;
    }

    response.code = 200;
    response.headers = [["Content-Type", "application/json"]];
    response.body = JSON.stringify({
      heartbeat: {
        online: state.heartbeat.online,
        lastPing: state.heartbeat.lastPing
      },
      emergencyShutdown: {
        active: state.emergencyShutdown.active,
        activationInProgress: state.emergencyShutdown.activationInProgress
      },
      relays: relayStates
    });
    response.send();
  });

  HTTPServer.registerEndpoint("reset-state", function(_request, response) {
    state.heartbeat.online = null;
    state.heartbeat.lastPing = null;
    state.emergencyShutdown.active = false;
    state.emergencyShutdown.activationInProgress = false;
    for (let i = 0; i < CONFIG.RELAYS.length; i++) {
      state.relays[CONFIG.RELAYS[i]].on = true;
      state.relays[CONFIG.RELAYS[i]].lastUpdate = 0;
    }

    response.code = 200;
    response.headers = [["Content-Type", "application/json"]];
    response.body = JSON.stringify({ success: true, message: "State reset" });
    response.send();

    log("🧪 TEST: State reset to initial values");
  });

  log("🧪 HTTP endpoints available:");
  log("  - GET  /script/1/heartbeat      (simulate Pro3EM heartbeat)");
  log("  - GET  /script/1/get-status     (inspect internal state)");
  log("  - POST /script/1/inject-status  (inject relay status change)");
  log("  - POST /script/1/reset-state    (reset to initial state)");
}
// ============================================================================
// STARTUP
// ============================================================================

init(function(){
  startHeartbeatMonitor();

  HTTPServer.registerEndpoint("heartbeat", handleHeartbeatRequest);

  if (!CONFIG.TEST_MODE) {
    Shelly.addStatusHandler(handleStatusUpdate);
  }else{
    setupTestMode();
    log("🧪 TEST MODE: Status handler disabled (using HTTP endpoint instead)");
  }
});
