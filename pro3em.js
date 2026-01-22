/******************************************************************************
 * INTELLIGENT THREE-PHASE LOAD SHEDDING - Pro 3EM
 * Version: 2.0-UNIFIED
 * Author: Clément
 *
 * Installation: Shelly Pro 3EM → Settings → Scripts → Add Script
 * IP: 10.0.0.100
 *
 * ⚙️ SIMULATION MODE: Set MODE_SIMULATION to true for testing without hardware
 ******************************************************************************/

// ============================================================================
// CONFIGURATION
// ============================================================================

let CONFIG = {
  // ⚠️ SIMULATION MODE TOGGLE
  MODE_SIMULATION: true,      // true = simulation only, false = real commands
  
  // Network addresses
  PRO3_IP: "10.0.0.101",
  
  // ⚡ OPTIMIZED THRESHOLDS FOR 30A THREE-PHASE ENEDIS CIRCUIT BREAKER
  SHEDDING_THRESHOLD_L1: 28,    // 2A margin (uses 93% of rating)
  SHEDDING_THRESHOLD_L2: 28,
  SHEDDING_THRESHOLD_L3: 28,
  
  RESTORATION_THRESHOLD_L1: 26,    // 2A hysteresis
  RESTORATION_THRESHOLD_L2: 26,
  RESTORATION_THRESHOLD_L3: 26,
  
  // Timings
  SHEDDING_DELAY: 2000,      // 2s (circuit breaker tolerates peaks well)
  RESTORATION_DELAY: 300000,    // 5min (300s) before restoring
  HEARTBEAT_INTERVAL: 5000,      // Heartbeat every 5s
  CYCLE_INTERVAL: 2000,          // Check every 2s
  
  // Progressive shedding (priority order)
  SHEDDING_ORDER: [2, 1, 0], // First L3, then L2, then L1
  
  // Debug mode
  DEBUG: true,
  
  // 📡 MQTT
  MQTT_ENABLED: true,         // Enable MQTT publishing
  MQTT_TOPIC_PREFIX: "load_shedding",  // MQTT topic prefix
  MQTT_PUBLISH_INTERVAL: 30000,     // Publish states every 30s

  // 🔒 FORCED SHEDDING (for summer mode, etc.)
  FORCE_SHEDDING_VAR: "force_shedding"  // Shelly KVS variable name to force all relays off
};

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

let state = {
  // Relay states (true = powered, false = shed)
  relay: [true, true, true],

  // Timestamp of last shedding per phase
  lastShedding: [0, 0, 0],

  // Consecutive exceedances counter
  exceedances: [0, 0, 0],

  // Overload in progress flag
  overload: [false, false, false],

  // Forced shedding mode (controlled by KVS variable)
  forcedShedding: false
};

// Simulation statistics (only used if MODE_SIMULATION = true)
let stats = {
  cycles: 0,
  sheddings: [0, 0, 0],
  restorations: [0, 0, 0],
  startTime: Date.now()
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(message) {
  if (CONFIG.DEBUG) {
    let prefix = CONFIG.MODE_SIMULATION ? "[PRO3EM-SIM]" : "[PRO3EM]";
    print(prefix + " " + message);
  }
}

function logSimulatedAction(action, phase) {
  if (!CONFIG.MODE_SIMULATION) return;
  
  let phaseName = ["L1", "L2", "L3"][phase];
  let symbol = action === "off" ? "[OFF]" : "[ON]";
  
  let msg = ">>> SIMULATED ACTION >>>\n" +
            "Relay " + phase + " (" + phaseName + ") -> " + action.toUpperCase() + "\n" +
            symbol + "\n" +
            ">>>>>>>>>>>>>>>>>>>>>>>";
  
  print(msg);
}

function sendCommand(relay, action) {
  if (CONFIG.MODE_SIMULATION) {
    // SIMULATION MODE: display action without executing
    logSimulatedAction(action, relay);

    // Update stats
    if (action === "off") {
      stats.sheddings[relay]++;
    } else {
      stats.restorations[relay]++;
    }
  } else {
    // PRODUCTION MODE: send real HTTP command
    let url = "http://" + CONFIG.PRO3_IP + "/relay/" + relay + "?turn=" + action;
    
    Shelly.call("HTTP.GET", {url: url}, function(result, error_code, error_message) {
      if (error_code !== 0) {
        log("ERROR relay command " + relay + ": " + error_message);
      } else {
        log("Command sent: relay " + relay + " -> " + action);
      }
    });
  }
  
  // 📡 Publish relay state on MQTT
  let newState = (action === "on");
  publishRelayState(relay, newState);
}

function sendHeartbeat() {
  if (CONFIG.MODE_SIMULATION) {
    // In simulation, just log
    log("Simulated heartbeat");
  } else {
    // In production, send real heartbeat
    let url = "http://" + CONFIG.PRO3_IP + "/rpc/Shelly.SetVar?name=heartbeat&value=" + Date.now();
    
    Shelly.call("HTTP.GET", {url: url}, function(result, error_code, error_message) {
      if (error_code !== 0) {
        log("ERROR heartbeat: " + error_message);
      }
    });
  }
}

// ============================================================================
// MQTT FUNCTIONS
// ============================================================================

function publishMQTT(topic, payload, retain) {
  if (!CONFIG.MQTT_ENABLED) return;
  
  let fullTopic = CONFIG.MQTT_TOPIC_PREFIX + "/" + topic;
  
  // Convert payload to string if it's an object
  let message = typeof payload === "object" ? JSON.stringify(payload) : String(payload);
  
  MQTT.publish(fullTopic, message, 0, retain || false);
  
  if (CONFIG.DEBUG) {
    log("[MQTT] " + fullTopic + " = " + message);
  }
}

function publishRelayState(phase, relayState) {
  let phaseName = ["L1", "L2", "L3"][phase];
  
  // Shelly RPC format
  let stateMsg = {
    method: "NotifyState",
    params: {
      ts: Date.now(),
      data: {
        phase: phaseName,
        active: relayState ? true : false
      }
    }
  };
  
  // Publish state (with retain to keep last state)
  publishMQTT(phaseName + "/state", stateMsg, true);
}

function publishEvent(phase, action, current) {
  let phaseName = ["L1", "L2", "L3"][phase];
  
  // Shelly RPC format
  let event = {
    method: "NotifyEvent",
    params: {
      ts: Date.now(),
      data: {
        phase: phaseName,
        relay: phase,
        action: action,
        current: current ? current.toFixed(2) : null
      }
    }
  };
  
  // Publish on events topic (without retain, it's a stream)
  publishMQTT("events", event, false);
  
  // Also publish on phase-specific topic
  publishMQTT(phaseName + "/event", event, false);
}

function publishRegularStates() {
  // Publish each relay state
  publishRelayState(0, state.relay[0]);
  publishRelayState(1, state.relay[1]);
  publishRelayState(2, state.relay[2]);
  
  // Publish global heartbeat
  let status = {
    method: "NotifyStatus",
    params: {
      ts: Date.now(),
      data: {
        l1_active: state.relay[0] ? true : false,
        l2_active: state.relay[1] ? true : false,
        l3_active: state.relay[2] ? true : false
      }
    }
  };
  
  publishMQTT("status", status, false);
  
  if (CONFIG.DEBUG) {
    log("[MQTT] Regular states published");
  }
}

function displayStats() {
  if (!CONFIG.MODE_SIMULATION) return;
  
  let duration = Math.floor((Date.now() - stats.startTime) / 1000);
  
  let msg = "\n=== SIMULATION STATS ===\n" +
            "Duration: " + duration + "s | Cycles: " + stats.cycles + "\n" +
            "L1: Shed=" + stats.sheddings[0] + " Restore=" + stats.restorations[0] + " | State: " + (state.relay[0] ? "ON" : "OFF") + "\n" +
            "L2: Shed=" + stats.sheddings[1] + " Restore=" + stats.restorations[1] + " | State: " + (state.relay[1] ? "ON" : "OFF") + "\n" +
            "L3: Shed=" + stats.sheddings[2] + " Restore=" + stats.restorations[2] + " | State: " + (state.relay[2] ? "ON" : "OFF") + "\n" +
            "========================\n";
  
  print(msg);
}

// ============================================================================
// SHEDDING LOGIC
// ============================================================================

function checkPhase(phase, current, sheddingThreshold, restorationThreshold) {
  let now = Date.now();
  let phaseName = ["L1", "L2", "L3"][phase];
  
  // ---- OVERLOAD DETECTION ----
  if (current > sheddingThreshold) {
    state.exceedances[phase]++;

    // Shed after X consecutive exceedances (filtering)
    if (state.exceedances[phase] >= 2 && state.relay[phase]) {
      log("OVERLOAD " + phaseName + ": " + current.toFixed(2) + "A > " + sheddingThreshold + "A");

      // Immediate shedding if well above threshold
      if (current > sheddingThreshold * 1.2) {
        log("IMMEDIATE SHEDDING " + phaseName + " (overload > 120%)");
        sendCommand(phase, "off");
        state.relay[phase] = false;
        state.lastShedding[phase] = now;
        state.overload[phase] = true;

        // 📡 Publish MQTT event
        publishEvent(phase, "immediate_shedding", current);
      }
      // Otherwise wait for delay
      else if (!state.overload[phase]) {
        log("Starting shedding delay " + phaseName + " (" + (CONFIG.SHEDDING_DELAY/1000) + "s)");
        state.overload[phase] = true;

        Timer.set(CONFIG.SHEDDING_DELAY, false, function() {
          if (state.relay[phase]) {
            log("Delay elapsed -> SHEDDING " + phaseName);

            // Capture current for event
            Shelly.call("EM.GetStatus", {id: 0}, function(status) {
              let currentNow = 0;
              if (phase === 0) currentNow = status.a_current || 0;
              else if (phase === 1) currentNow = status.b_current || 0;
              else currentNow = status.c_current || 0;

              sendCommand(phase, "off");
              state.relay[phase] = false;
              state.lastShedding[phase] = Date.now();

              // 📡 Publish MQTT event
              publishEvent(phase, "shedding", currentNow);
            });
          }
        });
      }
    }
  }
  // ---- NO OVERLOAD ----
  else {
    state.exceedances[phase] = 0;
    state.overload[phase] = false;

    // ---- RESTORATION ----
    if (current < restorationThreshold && !state.relay[phase]) {
      let elapsed = now - state.lastShedding[phase];

      if (elapsed >= CONFIG.RESTORATION_DELAY) {
        log("RESTORATION " + phaseName + " (delay " + (CONFIG.RESTORATION_DELAY/1000) + "s elapsed)");
        sendCommand(phase, "on");
        state.relay[phase] = true;

        // 📡 Publish MQTT event
        publishEvent(phase, "restoration", current);
      } else {
        let remaining = Math.floor((CONFIG.RESTORATION_DELAY - elapsed) / 1000);
        if (remaining % 30 === 0) { // Display every 30s
          log(phaseName + " can restore in " + remaining + "s");
        }
      }
    }
  }
}

// ============================================================================
// MAIN CYCLE
// ============================================================================

function mainCycle() {
  if (CONFIG.MODE_SIMULATION) {
    stats.cycles++;
  }

  // Check forced shedding variable
  Shelly.call("KVS.Get", {key: CONFIG.FORCE_SHEDDING_VAR}, function(result, error_code) {
    let forceShedding = false;

    if (error_code === 0 && result && result.value !== undefined) {
      // Parse the value (can be boolean, string "true"/"false", or number 1/0)
      if (typeof result.value === "boolean") {
        forceShedding = result.value;
      } else if (typeof result.value === "string") {
        forceShedding = (result.value.toLowerCase() === "true" || result.value === "1");
      } else if (typeof result.value === "number") {
        forceShedding = (result.value === 1);
      }
    }

    // If force shedding mode changed, log it
    if (forceShedding !== state.forcedShedding) {
      state.forcedShedding = forceShedding;
      log("🔒 FORCED SHEDDING MODE: " + (forceShedding ? "ENABLED" : "DISABLED"));

      // If entering forced mode, shed all relays
      if (forceShedding) {
        for (let i = 0; i < 3; i++) {
          if (state.relay[i]) {
            sendCommand(i, "off");
            state.relay[i] = false;
            publishEvent(i, "forced_shedding", 0);
          }
        }
      }
    }

    // If forced shedding is active, keep all relays off and skip normal checks
    if (state.forcedShedding) {
      for (let i = 0; i < 3; i++) {
        if (state.relay[i]) {
          sendCommand(i, "off");
          state.relay[i] = false;
        }
      }
      return; // Skip normal load shedding logic
    }

    // Normal operation: read currents and check phases
    Shelly.call("EM.GetStatus", {id: 0}, function(status, error_code, error_message) {
      if (error_code !== 0) {
        log("ERROR reading EM: " + error_message);
        return;
      }

      // Currents per phase
      let I_L1 = status.a_current || 0;
      let I_L2 = status.b_current || 0;
      let I_L3 = status.c_current || 0;

      // Display with color codes in simulation mode
      if (CONFIG.MODE_SIMULATION) {
        let color_L1 = I_L1 > CONFIG.SHEDDING_THRESHOLD_L1 ? "[!]" : (I_L1 > CONFIG.RESTORATION_THRESHOLD_L1 ? "[~]" : "[OK]");
        let color_L2 = I_L2 > CONFIG.SHEDDING_THRESHOLD_L2 ? "[!]" : (I_L2 > CONFIG.RESTORATION_THRESHOLD_L2 ? "[~]" : "[OK]");
        let color_L3 = I_L3 > CONFIG.SHEDDING_THRESHOLD_L3 ? "[!]" : (I_L3 > CONFIG.RESTORATION_THRESHOLD_L3 ? "[~]" : "[OK]");

        log("Measurements: " +
            color_L1 + "L1=" + I_L1.toFixed(2) + "A  " +
            color_L2 + "L2=" + I_L2.toFixed(2) + "A  " +
            color_L3 + "L3=" + I_L3.toFixed(2) + "A");
      } else {
        log("Measurements: L1=" + I_L1.toFixed(2) + "A, L2=" + I_L2.toFixed(2) + "A, L3=" + I_L3.toFixed(2) + "A");
      }

      // Check each phase
      checkPhase(0, I_L1, CONFIG.SHEDDING_THRESHOLD_L1, CONFIG.RESTORATION_THRESHOLD_L1);
      checkPhase(1, I_L2, CONFIG.SHEDDING_THRESHOLD_L2, CONFIG.RESTORATION_THRESHOLD_L2);
      checkPhase(2, I_L3, CONFIG.SHEDDING_THRESHOLD_L3, CONFIG.RESTORATION_THRESHOLD_L3);
    });
  });
}

// ============================================================================
// STARTUP
// ============================================================================

let mode = CONFIG.MODE_SIMULATION ? "SIMULATION MODE" : "PRODUCTION MODE";
let header = "\n" +
             "==============================================\n" +
             "  INTELLIGENT THREE-PHASE LOAD SHEDDING\n" +
             "==============================================\n" +
             "MODE: " + mode + "\n" +
             (CONFIG.MODE_SIMULATION ? "-> Actions simulated and displayed only\n" : "-> Real commands sent to Pro 3EM\n") +
             "==============================================\n";
print(header);

let startMsg = "Pro 3 IP: " + CONFIG.PRO3_IP + "\n" +
               "Shedding thresholds: L1=" + CONFIG.SHEDDING_THRESHOLD_L1 + "A, L2=" + CONFIG.SHEDDING_THRESHOLD_L2 + "A, L3=" + CONFIG.SHEDDING_THRESHOLD_L3 + "A\n" +
               "Restoration thresholds: L1=" + CONFIG.RESTORATION_THRESHOLD_L1 + "A, L2=" + CONFIG.RESTORATION_THRESHOLD_L2 + "A, L3=" + CONFIG.RESTORATION_THRESHOLD_L3 + "A\n" +
               "Restoration delay: " + (CONFIG.RESTORATION_DELAY/1000) + "s\n" +
               "MQTT: " + (CONFIG.MQTT_ENABLED ? "Enabled (prefix: " + CONFIG.MQTT_TOPIC_PREFIX + ")" : "Disabled") + "\n\n" +
               "[OK] System operational!\n";

if (CONFIG.MODE_SIMULATION) {
  startMsg += "[INFO] Stats displayed every 60 seconds\n";
}

log(startMsg);

// 📡 Publish initial states on MQTT
if (CONFIG.MQTT_ENABLED) {
  publishRelayState(0, state.relay[0]);
  publishRelayState(1, state.relay[1]);
  publishRelayState(2, state.relay[2]);
  publishRegularStates();
  log("[MQTT] Initial states published");
}

// Main cycle timer
Timer.set(CONFIG.CYCLE_INTERVAL, true, mainCycle);

// Heartbeat timer
Timer.set(CONFIG.HEARTBEAT_INTERVAL, true, sendHeartbeat);

// Stats timer (only in simulation mode)
if (CONFIG.MODE_SIMULATION) {
  Timer.set(60000, true, displayStats);
}

// Regular MQTT publication timer
if (CONFIG.MQTT_ENABLED) {
  Timer.set(CONFIG.MQTT_PUBLISH_INTERVAL, true, publishRegularStates);
  log("[MQTT] State publication every " + (CONFIG.MQTT_PUBLISH_INTERVAL/1000) + "s");
}
