/**
 * TEST SCENARIOS - Safety Protection (Pro 3)
 * Tests heartbeat monitoring and emergency shutdown via HTTP endpoints
 *
 * Prerequisites:
 *   1. Set TEST_MODE=true in safety-protection.js CONFIG
 *   2. Deploy safety-protection.js to Shelly Pro 3
 *   3. Run: node scenarios-safety.js [scenario_number|A]
 *
 * Timing note:
 *   Tests respect the configured timeout (60s).
 *   A full run takes several minutes. Individual scenarios can be run
 *   for faster feedback.
 */

const axios = require("axios");

// Configuration
const SHELLY_IP = process.env.SHELLY_IP || "192.168.1.102";
const SHELLY_SCRIPT_ID = process.env.SHELLY_SCRIPT_ID || "4";
const SHELLY_BASE_URL = `http://${SHELLY_IP}`;
const HEARTBEAT_ENDPOINT = `${SHELLY_BASE_URL}/script/${SHELLY_SCRIPT_ID}/heartbeat`;
const GET_STATUS_ENDPOINT = `${SHELLY_BASE_URL}/script/${SHELLY_SCRIPT_ID}/get-status`;
const INJECT_STATUS_ENDPOINT = `${SHELLY_BASE_URL}/script/${SHELLY_SCRIPT_ID}/inject-status`;
const RESET_STATE_ENDPOINT = `${SHELLY_BASE_URL}/script/${SHELLY_SCRIPT_ID}/reset-state`;

// Match safety-protection.js CONFIG values
const HEARTBEAT_CHECK_INTERVAL = 5000;
const HEARTBEAT_TIMEOUT = 60000;

// ============================================================================
// Helpers
// ============================================================================

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendHeartbeat() {
  try {
    const response = await axios.get(HEARTBEAT_ENDPOINT);
    console.log(`   💓 Heartbeat sent -> emergency_mode=${response.data.emergency_mode}`);
    return response.data;
  } catch (error) {
    console.error(`   ❌ Failed to send heartbeat: ${error.message}`);
    throw error;
  }
}

/**
 * Send heartbeats at regular intervals for a given duration
 */
async function sendHeartbeats(durationMs, intervalMs) {
  intervalMs = intervalMs || 5000;
  const count = Math.ceil(durationMs / intervalMs);
  console.log(`   💓 Sending ${count} heartbeats over ${durationMs / 1000}s...`);
  for (let i = 0; i < count; i++) {
    await sendHeartbeat();
    if (i < count - 1) await sleep(intervalMs);
  }
}

async function getStatus() {
  try {
    const response = await axios.get(GET_STATUS_ENDPOINT);
    return response.data;
  } catch (error) {
    console.error(`   ❌ Failed to get status: ${error.message}`);
    throw error;
  }
}

async function injectRelayStatus(relayId, output) {
  try {
    const response = await axios.post(INJECT_STATUS_ENDPOINT, {
      component: "switch:" + relayId,
      delta: { output: output }
    });
    console.log(`   📤 Injected relay ${relayId} -> ${output ? "ON" : "OFF"}`);
    return response.data;
  } catch (error) {
    console.error(`   ❌ Failed to inject relay status: ${error.message}`);
    throw error;
  }
}

async function resetState() {
  try {
    await axios.post(RESET_STATE_ENDPOINT);
    console.log("   🔄 State reset");
    await sleep(1000);
  } catch (error) {
    console.error(`   ❌ Failed to reset state: ${error.message}`);
    throw error;
  }
}

function printHeader(title) {
  console.log("\n" + "=".repeat(80));
  console.log(title);
  console.log("=".repeat(80));
}

function check(condition, message) {
  const status = condition ? "✅" : "❌";
  console.log(`   ${status} ${message}`);
  return condition;
}

function printStatus(status) {
  console.log("\n📊 Current Status:");
  console.log(`   Heartbeat online: ${status.heartbeat.online}`);
  console.log(`   Heartbeat lastPing: ${status.heartbeat.lastPing}`);
  console.log(`   Emergency active: ${status.emergencyShutdown.active}`);
  console.log(`   Emergency in progress: ${status.emergencyShutdown.activationInProgress}`);
  for (let key in status.relays) {
    console.log(`   ${key}: ${status.relays[key]}`);
  }
}

// ============================================================================
// SCENARIO 1: Normal heartbeat flow -> online
// ============================================================================
async function scenario1_normalHeartbeatFlow() {
  printHeader("SCENARIO 1: Normal heartbeat flow (heartbeat -> online)");
  await resetState();

  console.log("\n📤 Step 1: Send first heartbeat...");
  await sendHeartbeat();

  // Wait for monitor to detect heartbeat and transition to online
  await sleep(HEARTBEAT_CHECK_INTERVAL + 1000);

  let status = await getStatus();
  if (!check(status.heartbeat.lastPing !== null, "Step 1: lastPing is set")) return false;
  if (!check(status.heartbeat.online === true, "Step 1: now online")) {
    printStatus(status);
    return false;
  }
  if (!check(!status.emergencyShutdown.active, "Step 1: no emergency shutdown")) return false;
  if (!check(status.relays.relay0 === true, "Step 1: relay 0 is ON")) return false;
  if (!check(status.relays.relay1 === true, "Step 1: relay 1 is ON")) return false;
  if (!check(status.relays.relay2 === true, "Step 1: relay 2 is ON")) return false;

  return true;
}

// ============================================================================
// SCENARIO 2: Emergency shutdown on heartbeat loss
// ============================================================================
async function scenario2_emergencyShutdown() {
  printHeader("SCENARIO 2: Emergency shutdown on heartbeat loss");
  await resetState();

  console.log("\n📤 Step 1: Establish online state...");
  await sendHeartbeat();
  await sleep(HEARTBEAT_CHECK_INTERVAL + 1000);

  let status = await getStatus();
  if (!check(status.heartbeat.online === true, "Step 1: online")) {
    printStatus(status);
    return false;
  }

  console.log("\n⏳ Step 2: Stop heartbeats, wait for timeout (" + HEARTBEAT_TIMEOUT / 1000 + "s + margin)...");
  await sleep(HEARTBEAT_TIMEOUT + HEARTBEAT_CHECK_INTERVAL + 2000);

  status = await getStatus();
  if (!check(status.heartbeat.online === false, "Step 2: offline")) {
    printStatus(status);
    return false;
  }
  if (!check(status.emergencyShutdown.active === true, "Step 2: emergency shutdown active")) {
    printStatus(status);
    return false;
  }
  if (!check(status.relays.relay0 === false, "Step 2: relay 0 cut")) return false;
  if (!check(status.relays.relay1 === false, "Step 2: relay 1 cut")) return false;
  if (!check(status.relays.relay2 === false, "Step 2: relay 2 cut")) return false;

  return true;
}

// ============================================================================
// SCENARIO 3: Recovery after emergency shutdown
// ============================================================================
async function scenario3_recovery() {
  printHeader("SCENARIO 3: Recovery after emergency shutdown");
  await resetState();

  console.log("\n📤 Step 1: Establish online then trigger emergency...");
  await sendHeartbeat();
  await sleep(HEARTBEAT_CHECK_INTERVAL + 1000);

  let status = await getStatus();
  if (!check(status.heartbeat.online === true, "Step 1: online")) {
    printStatus(status);
    return false;
  }

  console.log("\n⏳ Step 2: Wait for emergency shutdown...");
  await sleep(HEARTBEAT_TIMEOUT + HEARTBEAT_CHECK_INTERVAL + 2000);

  status = await getStatus();
  if (!check(status.emergencyShutdown.active === true, "Step 2: emergency active")) {
    printStatus(status);
    return false;
  }

  console.log("\n📤 Step 3: Resume heartbeats to recover...");
  await sendHeartbeat();
  await sleep(HEARTBEAT_CHECK_INTERVAL + 1000);

  status = await getStatus();
  if (!check(status.heartbeat.online === true, "Step 3: back online")) {
    printStatus(status);
    return false;
  }
  if (!check(status.emergencyShutdown.active === false, "Step 3: emergency cancelled")) {
    printStatus(status);
    return false;
  }

  return true;
}

// ============================================================================
// SCENARIO 4: Relay state via inject-status
// ============================================================================
async function scenario4_injectRelayStatus() {
  printHeader("SCENARIO 4: Relay state changes via inject-status");
  await resetState();

  console.log("\n📤 Step 1: Establish online state...");
  await sendHeartbeat();
  await sleep(HEARTBEAT_CHECK_INTERVAL + 1000);

  let status = await getStatus();
  if (!check(status.relays.relay0 === true, "Step 1: relay 0 is ON")) return false;

  console.log("\n📤 Step 2: Inject relay 0 -> OFF...");
  await injectRelayStatus(0, false);
  await sleep(500);

  status = await getStatus();
  if (!check(status.relays.relay0 === false, "Step 2: relay 0 is now OFF")) {
    printStatus(status);
    return false;
  }
  if (!check(status.relays.relay1 === true, "Step 2: relay 1 unchanged (ON)")) return false;
  if (!check(status.relays.relay2 === true, "Step 2: relay 2 unchanged (ON)")) return false;

  console.log("\n📤 Step 3: Inject relay 0 -> ON...");
  await injectRelayStatus(0, true);
  await sleep(500);

  status = await getStatus();
  if (!check(status.relays.relay0 === true, "Step 3: relay 0 back ON")) return false;

  return true;
}

// ============================================================================
// SCENARIO 5: Heartbeat response contains relay states
// ============================================================================
async function scenario5_heartbeatResponse() {
  printHeader("SCENARIO 5: Heartbeat response contains correct relay states");
  await resetState();

  console.log("\n📤 Step 1: Establish online state...");
  await sendHeartbeat();
  await sleep(HEARTBEAT_CHECK_INTERVAL + 1000);

  console.log("\n📤 Step 2: Inject relay 1 -> OFF...");
  await injectRelayStatus(1, false);
  await sleep(500);

  console.log("\n📤 Step 3: Send heartbeat and check response...");
  let heartbeatResponse = await sendHeartbeat();

  if (!check(heartbeatResponse.status === "ok", "Step 3: status is ok")) return false;
  if (!check(heartbeatResponse.relays.relay0 === true, "Step 3: response relay0 = ON")) return false;
  if (!check(heartbeatResponse.relays.relay1 === false, "Step 3: response relay1 = OFF")) return false;
  if (!check(heartbeatResponse.relays.relay2 === true, "Step 3: response relay2 = ON")) return false;
  if (!check(heartbeatResponse.emergency_mode === false, "Step 3: response emergency_mode = false")) return false;

  // Restore relay 1
  await injectRelayStatus(1, true);

  return true;
}

// ============================================================================
// Interactive Menu & Runner
// ============================================================================

async function showMenu() {
  console.log("\n╔" + "═".repeat(78) + "╗");
  console.log("║" + " ".repeat(16) + "SAFETY PROTECTION TEST SCENARIOS" + " ".repeat(30) + "║");
  console.log("╚" + "═".repeat(78) + "╝\n");
  console.log(`🎯 Target Shelly Pro 3: ${SHELLY_BASE_URL}`);
  console.log(`📝 Script ID: ${SHELLY_SCRIPT_ID}`);
  console.log(`🔗 Heartbeat: ${HEARTBEAT_ENDPOINT}\n`);
  console.log("⚠️  Prerequisites:");
  console.log("   1. Set TEST_MODE=true in safety-protection.js CONFIG");
  console.log("   2. Deploy safety-protection.js to Shelly Pro 3");
  console.log("   3. Restart the script on the device\n");
  console.log("⏱️  Timing:");
  console.log(`   Timeout: ${HEARTBEAT_TIMEOUT / 1000}s`);
  console.log("   Full run takes several minutes due to timeouts\n");
  console.log("📌 Configuration:");
  console.log(`   Set SHELLY_IP env var to change target (current: ${SHELLY_IP})`);
  console.log(`   Set SHELLY_SCRIPT_ID to change script ID (current: ${SHELLY_SCRIPT_ID})\n`);
  console.log("Available scenarios:");
  console.log("   1 - Normal Heartbeat Flow");
  console.log("   2 - Emergency Shutdown (heartbeat loss)");
  console.log("   3 - Recovery After Emergency");
  console.log("   4 - Relay State Injection");
  console.log("   5 - Heartbeat Response Content");
  console.log("   A - Run all scenarios");
  console.log("   Q - Quit\n");
}

async function runScenario(choice) {
  try {
    switch (choice) {
      case "1":
        return await scenario1_normalHeartbeatFlow();
      case "2":
        return await scenario2_emergencyShutdown();
      case "3":
        return await scenario3_recovery();
      case "4":
        return await scenario4_injectRelayStatus();
      case "5":
        return await scenario5_heartbeatResponse();
      case "A":
      case "a":
        return await runAllScenarios();
      default:
        console.log("❌ Invalid choice");
    }
  } catch (error) {
    console.error("\n❌ Scenario failed:", error.message);
  }
}

async function runAllScenarios() {
  const scenarios = [
    { name: "Scenario 1: Normal Heartbeat Flow", fn: scenario1_normalHeartbeatFlow },
    { name: "Scenario 2: Emergency Shutdown", fn: scenario2_emergencyShutdown },
    { name: "Scenario 3: Recovery After Emergency", fn: scenario3_recovery },
    { name: "Scenario 4: Relay State Injection", fn: scenario4_injectRelayStatus },
    { name: "Scenario 5: Heartbeat Response Content", fn: scenario5_heartbeatResponse }
  ];

  console.log("\n🚀 Running all scenarios...\n");

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const scenario of scenarios) {
    try {
      const result = await scenario.fn();
      if (result) {
        passed++;
        results.push({ name: scenario.name, status: "✅ PASS" });
        console.log(`\n✅ ${scenario.name} PASSED`);
      } else {
        failed++;
        results.push({ name: scenario.name, status: "❌ FAIL" });
        console.log(`\n❌ ${scenario.name} FAILED`);
      }
      await sleep(3000);
    } catch (error) {
      failed++;
      results.push({ name: scenario.name, status: "❌ ERROR" });
      console.log(`\n❌ ${scenario.name} ERROR: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(80));
  for (const r of results) {
    console.log(`   ${r.status} ${r.name}`);
  }
  console.log("─".repeat(80));
  console.log(`   Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log("=".repeat(80) + "\n");

  return failed === 0;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    await runScenario(args[0].toUpperCase());
  } else {
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const askQuestion = () => {
      showMenu();
      rl.question("Choose scenario: ", async (answer) => {
        if (answer.toUpperCase() === "Q") {
          console.log("👋 Goodbye!\n");
          rl.close();
          return;
        }
        await runScenario(answer);
        console.log("\n" + "─".repeat(80));
        setTimeout(askQuestion, 1000);
      });
    };

    askQuestion();
  }
}

module.exports = {
  scenario1_normalHeartbeatFlow,
  scenario2_emergencyShutdown,
  scenario3_recovery,
  scenario4_injectRelayStatus,
  scenario5_heartbeatResponse,
  runAllScenarios,
  sendHeartbeat,
  sendHeartbeats,
  getStatus,
  injectRelayStatus,
  resetState
};

if (require.main === module) {
  main().catch(console.error);
}
