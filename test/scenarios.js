/**
 * TEST SCENARIOS - Tests real Shelly with TEST_MODE
 * Injects status via HTTP endpoint on real Shelly Pro 3EM
 */

const axios = require("axios");

// Configuration
const SHELLY_IP = process.env.SHELLY_IP || "192.168.1.102";
const SHELLY_SCRIPT_ID = process.env.SHELLY_SCRIPT_ID || "2";
const SHELLY_BASE_URL = `http://${SHELLY_IP}`;
const INJECT_ENDPOINT = `${SHELLY_BASE_URL}/script/${SHELLY_SCRIPT_ID}/inject-status`;
const GET_STATUS_ENDPOINT = `${SHELLY_BASE_URL}/script/${SHELLY_SCRIPT_ID}/get-status`;
const RESET_STATE_ENDPOINT = `${SHELLY_BASE_URL}/script/${SHELLY_SCRIPT_ID}/reset-state`;
const MOCK_SERVER_URL = process.env.MOCK_SERVER_URL || "http://192.168.1.100:3100";

// Helper functions
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function injectStatus(l1, l2, l3) {
  try {
    const response = await axios.post(INJECT_ENDPOINT, {
      component: "em:0",
      delta: {
        a_current: l1,
        b_current: l2,
        c_current: l3
      }
    });
    console.log(`   📤 Injected: L1=${l1}A, L2=${l2}A, L3=${l3}A`);
    return response.data;
  } catch (error) {
    console.error(`   ❌ Failed to inject status: ${error.message}`);
    if (error.code === "ECONNREFUSED") {
      console.error(`   ⚠️  Is Shelly reachable at ${SHELLY_BASE_URL}?`);
    }
    throw error;
  }
}

async function injectETH(connected) {
  try {
    const response = await axios.post(INJECT_ENDPOINT, {
      component: "eth",
      delta: {
        ip: connected ? "10.0.0.100" : null
      }
    });
    console.log(`   📤 ETH status: ${connected ? "CONNECTED" : "DISCONNECTED"}`);
    return response.data;
  } catch (error) {
    console.error(`   ❌ Failed to inject ETH status: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// Status & Control Helpers
// ============================================================================

/**
 * Get current state from Shelly load-shedder
 */
async function getShellyStatus() {
  try {
    const response = await axios.get(GET_STATUS_ENDPOINT);
    return response.data.data;
  } catch (error) {
    console.error(`   ❌ Failed to get Shelly status: ${error.message}`);
    throw error;
  }
}

/**
 * Get mock server status (relays state)
 */
async function getMockServerStatus() {
  try {
    const response = await axios.get(`${MOCK_SERVER_URL}/status`);
    return response.data;
  } catch (error) {
    console.error(`   ❌ Failed to get mock server status: ${error.message}`);
    throw error;
  }
}

/**
 * Set mock server relay state
 */
async function setMockRelay(relayId, state) {
  try {
    const response = await axios.post(`${MOCK_SERVER_URL}/set-relay`, {
      relayId: relayId,
      state: state
    });
    console.log(`   🔧 Mock relay ${relayId} set to ${state ? "ON" : "OFF"}`);
    return response.data;
  } catch (error) {
    console.error(`   ❌ Failed to set mock relay: ${error.message}`);
    throw error;
  }
}

/**
 * Set mock server online/offline
 */
async function setMockOnline(online) {
  try {
    const response = await axios.post(`${MOCK_SERVER_URL}/set-online`, {
      online: online
    });
    console.log(`   🔧 Mock server set to ${online ? "ONLINE" : "OFFLINE"}`);
    return response.data;
  } catch (error) {
    console.error(`   ❌ Failed to set mock online state: ${error.message}`);
    throw error;
  }
}

/**
 * Print detailed status from both Shelly and Mock Server
 */
async function printStatus(shellyStatus, mockStatus) {
  console.log("\n📊 Current Status:");

  try {
    console.log("\n🔌 Shelly Load-Shedder:");
    console.log(`   Pro3: ${shellyStatus.pro3_online ? "✅ Online" : "❌ Offline"}`);

    console.log("\n   L1:");
    console.log(`     Overload: ${shellyStatus.l1_overload}`);
    console.log(`     Shedding: ${shellyStatus.l1_shedding}`);
    console.log(`     Relay: ${shellyStatus.l1_relay_status}`);
    console.log(`     Current: ${shellyStatus.l1_current}A`);
    console.log(`     Last shedding: ${shellyStatus.l1_last_shedding}`);
    console.log(`     Shedding count: ${shellyStatus.l1_shedding_count}`);

    console.log("\n   L2:");
    console.log(`     Overload: ${shellyStatus.l2_overload}`);
    console.log(`     Shedding: ${shellyStatus.l2_shedding}`);
    console.log(`     Relay: ${shellyStatus.l2_relay_status}`);
    console.log(`     Current: ${shellyStatus.l2_current}A`);
    console.log(`     Last shedding: ${shellyStatus.l2_last_shedding}`);
    console.log(`     Shedding count: ${shellyStatus.l2_shedding_count}`);

    console.log("\n   L3:");
    console.log(`     Overload: ${shellyStatus.l3_overload}`);
    console.log(`     Shedding: ${shellyStatus.l3_shedding}`);
    console.log(`     Relay: ${shellyStatus.l3_relay_status}`);
    console.log(`     Current: ${shellyStatus.l3_current}A`);
    console.log(`     Last shedding: ${shellyStatus.l3_last_shedding}`);
    console.log(`     Shedding count: ${shellyStatus.l3_shedding_count}`);

    console.log("\n🔌 Mock Server (Pro3):");
    console.log(`   Online: ${mockStatus.online ? "✅" : "❌"}`);
    console.log(`   Relay 0 (L1): ${mockStatus.relays[0] ? "✅ ON" : "❌ OFF"}`);
    console.log(`   Relay 1 (L2): ${mockStatus.relays[1] ? "✅ ON" : "❌ OFF"}`);
    console.log(`   Relay 2 (L3): ${mockStatus.relays[2] ? "✅ ON" : "❌ OFF"}`);
  } catch (error) {
    console.error("   ❌ Failed to get status:", error.message);
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

/**
 * Reset state: inject normal currents, wait for restoration, verify clean state
 */
async function resetState() {
  console.log("\n🔄 Resetting state...");
  // Reset Shelly internal state via endpoint
  try {
    await axios.post(RESET_STATE_ENDPOINT);
  } catch (error) {
    console.error(`   ❌ Failed to reset Shelly state: ${error.message}`);
    throw error;
  }
  // Reset mock server to match
  await setMockOnline(true);
  await setMockRelay(0, true);
  await setMockRelay(1, true);
  await setMockRelay(2, true);
  await sleep(1000);
  console.log("   🔄 State reset complete");
}

/**
 * Assert all phases are in normal state (no shedding, no overload, all relays ON)
 */
async function assertNormalState(label) {
  const shellyStatus = await getShellyStatus();
  const mockStatus = await getMockServerStatus();
  let pass = true;

  pass =
    check(
      !shellyStatus.l1_shedding && !shellyStatus.l2_shedding && !shellyStatus.l3_shedding,
      `${label}: no phase is shedding`
    ) && pass;
  pass =
    check(
      !shellyStatus.l1_overload && !shellyStatus.l2_overload && !shellyStatus.l3_overload,
      `${label}: no phase is overloaded`
    ) && pass;
  pass =
    check(mockStatus.relays[0] && mockStatus.relays[1] && mockStatus.relays[2], `${label}: all relays are ON`) && pass;

  if (!pass) await printStatus(shellyStatus, mockStatus);
  return { pass, shellyStatus, mockStatus };
}

/**
 * Assert a specific phase is shed (shedding=true, relay=OFF)
 */
async function assertPhaseShed(phase, label) {
  const shellyStatus = await getShellyStatus();
  const mockStatus = await getMockServerStatus();
  const p = phase.toLowerCase();
  const relayIndex = { l1: 0, l2: 1, l3: 2 }[p];
  let pass = true;

  pass = check(shellyStatus[`${p}_overload`], `${label}: ${phase} is overloaded`) && pass;
  pass = check(shellyStatus[`${p}_shedding`], `${label}: ${phase} is shed`) && pass;
  pass = check(!mockStatus.relays[relayIndex], `${label}: ${phase} relay is OFF`) && pass;

  if (!pass) await printStatus(shellyStatus, mockStatus);
  return { pass, shellyStatus, mockStatus };
}

/**
 * Assert a specific phase is overloaded but NOT yet shed
 */
async function assertPhaseOverloadedNotShed(phase, label) {
  const shellyStatus = await getShellyStatus();
  const mockStatus = await getMockServerStatus();
  const p = phase.toLowerCase();
  const relayIndex = { l1: 0, l2: 1, l3: 2 }[p];
  let pass = true;

  pass = check(shellyStatus[`${p}_overload`], `${label}: ${phase} is overloaded`) && pass;
  pass = check(!shellyStatus[`${p}_shedding`], `${label}: ${phase} is NOT shed yet`) && pass;
  pass = check(mockStatus.relays[relayIndex], `${label}: ${phase} relay is still ON`) && pass;

  if (!pass) await printStatus(shellyStatus, mockStatus);
  return { pass, shellyStatus, mockStatus };
}

// ============================================================================
// SCENARIO 1: Normal Operation
// ============================================================================
async function scenario1_normalOperation() {
  printHeader("SCENARIO 1: Normal Operation (below threshold)");
  await resetState();

  console.log("\n📤 Injecting normal currents (20A on all phases)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  const { pass } = await assertNormalState("Normal operation");
  return pass;
}

// ============================================================================
// SCENARIO 2: Progressive Overload
// ============================================================================
async function scenario2_progressiveOverload() {
  printHeader("SCENARIO 2: Progressive Overload and Normal Shedding");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log("\n📤 Step 2: Overloading L1 to 29A (above 28A threshold)...");
  await injectStatus(29, 20, 20);
  await sleep(500);

  // L1 should be overloaded but NOT yet shed (delay not elapsed)
  let result = await assertPhaseOverloadedNotShed("L1", "Step 2");
  if (!result.pass) return false;
  let sheddingCountBefore = result.shellyStatus.l1_shedding_count;

  // L2 and L3 should be unaffected
  let pass = true;
  pass =
    check(
      !result.shellyStatus.l2_overload && !result.shellyStatus.l3_overload,
      "Step 2: L2 and L3 are not overloaded"
    ) && pass;
  pass =
    check(!result.shellyStatus.l2_shedding && !result.shellyStatus.l3_shedding, "Step 2: L2 and L3 are not shedding") &&
    pass;
  if (!pass) return false;

  console.log("\n⏳ Step 3: Waiting for shedding delay (2.5s)...");
  await sleep(2500);

  console.log("\n📤 Step 4: Maintaining overload (29A)...");
  await injectStatus(29, 20, 20);
  await sleep(500);

  // L1 should now be shed
  result = await assertPhaseShed("L1", "Step 4");
  if (!result.pass) return false;

  if (!check(result.shellyStatus.l1_shedding_count > sheddingCountBefore, "Step 4: L1 shedding count incremented"))
    return false;

  // L2 and L3 still unaffected
  if (!check(result.mockStatus.relays[1] && result.mockStatus.relays[2], "Step 4: L2 and L3 relays still ON"))
    return false;

  console.log("\n⏳ Step 5: Waiting for restoration (10s)...");
  await sleep(10000);

  console.log("\n📤 Step 6: Back to normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  const { pass: normalPass } = await assertNormalState("Step 6 - Restoration");
  return normalPass;
}

// ============================================================================
// SCENARIO 3: Immediate Shedding
// ============================================================================
async function scenario3_immediateShedding() {
  printHeader("SCENARIO 3: Immediate Shedding (>120% threshold)");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  let statusBefore = await getShellyStatus();
  let sheddingCountBefore = statusBefore.l2_shedding_count;

  console.log("\n📤 Step 2: Critical overload on L2 (35A > 33.6A immediate threshold)...");
  await injectStatus(20, 35, 20);
  await sleep(500); // Only 500ms - should be shed immediately (no 2s delay)

  // L2 should be shed immediately (no delay)
  let result = await assertPhaseShed("L2", "Step 2 - Immediate");
  if (!result.pass) return false;

  if (!check(result.shellyStatus.l2_shedding_count > sheddingCountBefore, "Step 2: L2 shedding count incremented"))
    return false;

  // L1 and L3 should be unaffected
  if (
    !check(!result.shellyStatus.l1_shedding && !result.shellyStatus.l3_shedding, "Step 2: L1 and L3 are not shedding")
  )
    return false;
  if (!check(result.mockStatus.relays[0] && result.mockStatus.relays[2], "Step 2: L1 and L3 relays still ON"))
    return false;

  console.log("\n⏳ Step 3: Waiting for restoration (10s)...");
  await sleep(10000);

  console.log("\n📤 Step 4: Back to normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  const { pass } = await assertNormalState("Step 4 - Restoration");
  return pass;
}

// ============================================================================
// SCENARIO 5: Pro3 Connection Loss
// ============================================================================
async function scenario5_pro3Offline() {
  printHeader("SCENARIO 5: Pro3 Connection Loss and Recovery");
  await resetState();

  console.log("\n📤 Step 1: Verify Pro3 is online...");
  let shellyStatus = await getShellyStatus();
  if (!check(shellyStatus.pro3_online, "Step 1: Pro3 is online")) return false;

  console.log("\n📤 Step 2: Setting Pro3 mock to OFFLINE...");
  await setMockOnline(false);

  console.log("\n⏳ Step 3: Waiting for heartbeat failure detection (15s)...");
  await sleep(15000);

  shellyStatus = await getShellyStatus();
  if (!check(!shellyStatus.pro3_online, "Step 3: Pro3 is detected as offline")) return false;
  if (!check(shellyStatus.l1_relay_status === "unknown", "Step 3: L1 relay status is unknown")) return false;
  if (!check(shellyStatus.l2_relay_status === "unknown", "Step 3: L2 relay status is unknown")) return false;
  if (!check(shellyStatus.l3_relay_status === "unknown", "Step 3: L3 relay status is unknown")) return false;

  console.log("\n📤 Step 4: Setting Pro3 mock back to ONLINE...");
  await setMockOnline(true);

  console.log("\n⏳ Step 5: Waiting for heartbeat recovery (15s)...");
  await sleep(15000);

  shellyStatus = await getShellyStatus();
  if (!check(shellyStatus.pro3_online, "Step 5: Pro3 is back online")) return false;
  if (!check(shellyStatus.l1_relay_status !== "unknown", "Step 5: L1 relay status is known")) return false;

  return true;
}

// ============================================================================
// SCENARIO 6: Multi-Phase Overload
// ============================================================================
async function scenario6_multiPhaseOverload() {
  printHeader("SCENARIO 6: Multiple Phase Overload");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log("\n📤 Step 2: Overloading all phases (29A each)...");
  await injectStatus(29, 29, 29);
  await sleep(500);

  // All phases should be overloaded but not yet shed
  let result;
  result = await assertPhaseOverloadedNotShed("L1", "Step 2");
  if (!result.pass) return false;
  result = await assertPhaseOverloadedNotShed("L2", "Step 2");
  if (!result.pass) return false;
  result = await assertPhaseOverloadedNotShed("L3", "Step 2");
  if (!result.pass) return false;

  console.log("\n⏳ Step 3: Waiting for shedding delay (2.5s)...");
  await sleep(2500);

  console.log("\n📤 Step 4: Maintaining overload...");
  await injectStatus(29, 29, 29);
  await sleep(500);

  // All phases should now be shed
  result = await assertPhaseShed("L1", "Step 4");
  if (!result.pass) return false;
  result = await assertPhaseShed("L2", "Step 4");
  if (!result.pass) return false;
  result = await assertPhaseShed("L3", "Step 4");
  if (!result.pass) return false;

  console.log("\n⏳ Step 5: Waiting for restoration (10s)...");
  await sleep(10000);

  console.log("\n📤 Step 6: Back to normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  const { pass } = await assertNormalState("Step 6 - Restoration");
  return pass;
}

// ============================================================================
// SCENARIO 7: Overload Cancellation
// ============================================================================
async function scenario7_overloadCancellation() {
  printHeader("SCENARIO 7: Overload Cancellation (current drops before delay)");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  let statusBefore = await getShellyStatus();
  let sheddingCountBefore = statusBefore.l1_shedding_count;

  console.log("\n📤 Step 2: Overloading L1 to 29A...");
  await injectStatus(29, 20, 20);
  await sleep(500);

  // L1 should be overloaded but not shed
  let result = await assertPhaseOverloadedNotShed("L1", "Step 2");
  if (!result.pass) return false;

  console.log("\n📤 Step 3: Reducing current BEFORE delay expires (1s < 2s delay)...");
  await sleep(1000);
  await injectStatus(25, 20, 20);
  await sleep(500);

  let shellyStatus = await getShellyStatus();
  let mockStatus = await getMockServerStatus();
  let pass = true;

  pass = check(!shellyStatus.l1_overload, "Step 3: L1 overload is cancelled") && pass;
  pass = check(!shellyStatus.l1_shedding, "Step 3: L1 was never shed") && pass;
  pass = check(mockStatus.relays[0], "Step 3: L1 relay still ON") && pass;
  pass = check(shellyStatus.l1_shedding_count === sheddingCountBefore, "Step 3: L1 shedding count unchanged") && pass;

  if (!pass) await printStatus(shellyStatus, mockStatus);
  return pass;
}

// ============================================================================
// SCENARIO 8: Ethernet Disconnection
// ============================================================================
async function scenario8_ethernetDisconnection() {
  printHeader("SCENARIO 8: Ethernet Disconnection");
  await resetState();

  console.log("\n📤 Step 1: Verify initial state (ethernet connected, Pro3 online)...");
  let shellyStatus = await getShellyStatus();
  if (!check(shellyStatus.pro3_online, "Step 1: Pro3 is online")) return false;

  console.log("\n📤 Step 2: Simulating Ethernet disconnection...");
  await injectETH(false);
  await sleep(2000);

  shellyStatus = await getShellyStatus();
  // When ethernet disconnects, Pro3 should go offline (heartbeat stops)
  if (!check(!shellyStatus.pro3_online, "Step 2: Pro3 detected as offline after ETH disconnect")) return false;
  if (!check(shellyStatus.l1_relay_status === "unknown", "Step 2: relay status is unknown")) return false;

  return true;
}

// ============================================================================
// SCENARIO 9: Ethernet Reconnection
// ============================================================================
async function scenario9_ethernetReconnection() {
  printHeader("SCENARIO 9: Ethernet Reconnection (after disconnection)");

  // Ensure we start from a disconnected state
  console.log("\n📤 Step 1: Ensuring ethernet is disconnected...");
  await injectETH(false);
  await sleep(2000);

  let shellyStatus = await getShellyStatus();
  if (!check(!shellyStatus.pro3_online, "Step 1: Pro3 is offline")) return false;

  console.log("\n📤 Step 2: Simulating Ethernet reconnection...");
  await injectETH(true);

  console.log("\n⏳ Step 3: Waiting for heartbeat recovery (15s)...");
  await sleep(15000);

  shellyStatus = await getShellyStatus();
  if (!check(shellyStatus.pro3_online, "Step 3: Pro3 is back online after ETH reconnect")) return false;
  if (!check(shellyStatus.l1_relay_status !== "unknown", "Step 3: relay status is known again")) return false;

  return true;
}

// ============================================================================
// SCENARIO 10: Hysteresis (current between thresholds after shedding)
// ============================================================================
async function scenario10_hysteresis() {
  printHeader("SCENARIO 10: Hysteresis - Current between shedding and restoration thresholds");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log("\n📤 Step 2: Overloading L1 to trigger immediate shedding (35A)...");
  await injectStatus(35, 20, 20);
  await sleep(500);

  let result = await assertPhaseShed("L1", "Step 2");
  if (!result.pass) return false;

  console.log("\n⏳ Step 3: Waiting for restoration delay (10s)...");
  await sleep(10000);

  console.log("\n📤 Step 4: Current drops to 27A (below 28A shedding, but ABOVE 26A restoration)...");
  await injectStatus(27, 20, 20);
  await sleep(1000);

  let shellyStatus = await getShellyStatus();
  let mockStatus = await getMockServerStatus();

  // L1 should STILL be shed - 27A is above restoration threshold (26A)
  if (!check(shellyStatus.l1_shedding, "Step 4: L1 still shed (27A > 26A restoration threshold)")) {
    await printStatus(shellyStatus, mockStatus);
    return false;
  }
  if (!check(!mockStatus.relays[0], "Step 4: L1 relay still OFF")) {
    await printStatus(shellyStatus, mockStatus);
    return false;
  }

  console.log("\n📤 Step 5: Current drops to 25A (below 26A restoration threshold)...");
  await injectStatus(25, 20, 20);
  await sleep(1000);

  shellyStatus = await getShellyStatus();
  mockStatus = await getMockServerStatus();

  // Now L1 should be restored
  if (!check(!shellyStatus.l1_shedding, "Step 5: L1 restored (25A < 26A restoration threshold)")) {
    await printStatus(shellyStatus, mockStatus);
    return false;
  }
  if (!check(mockStatus.relays[0], "Step 5: L1 relay back ON")) {
    await printStatus(shellyStatus, mockStatus);
    return false;
  }

  return true;
}

// ============================================================================
// SCENARIO 11: Threshold Edge Cases
// ============================================================================
async function scenario11_thresholdEdge() {
  printHeader("SCENARIO 11: Current exactly at threshold boundaries");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log("\n📤 Step 2: Current exactly at shedding threshold (28A)...");
  await injectStatus(28, 20, 20);
  await sleep(500);

  let shellyStatus = await getShellyStatus();
  // Code uses > (strict), so exactly 28A should NOT trigger overload
  if (!check(!shellyStatus.l1_overload, "Step 2: 28A exactly does NOT trigger overload (> not >=)")) return false;
  if (!check(!shellyStatus.l1_shedding, "Step 2: L1 not shed at exactly 28A")) return false;

  console.log("\n📤 Step 3: Current just above threshold (28.1A)...");
  await injectStatus(28.1, 20, 20);
  await sleep(500);

  shellyStatus = await getShellyStatus();
  if (!check(shellyStatus.l1_overload, "Step 3: 28.1A triggers overload")) return false;
  if (!check(!shellyStatus.l1_shedding, "Step 3: L1 not yet shed (delay not elapsed)")) return false;

  console.log("\n📤 Step 4: Current exactly at immediate threshold (33.6A)...");
  await injectStatus(33.6, 20, 20);
  await sleep(500);

  shellyStatus = await getShellyStatus();
  // Code uses > (strict), so exactly 33.6A should NOT trigger immediate shedding
  if (!check(!shellyStatus.l1_shedding, "Step 4: 33.6A exactly does NOT trigger immediate shedding")) return false;

  // Reset for clean state
  await injectStatus(20, 20, 20);
  await sleep(1000);

  return true;
}

// ============================================================================
// SCENARIO 12: Double Shedding Prevention
// ============================================================================
async function scenario12_doubleShedding() {
  printHeader("SCENARIO 12: Double shedding prevention (already shed phase)");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  let statusBefore = await getShellyStatus();
  let countBefore = statusBefore.l1_shedding_count;

  console.log("\n📤 Step 2: Trigger immediate shedding on L1 (35A)...");
  await injectStatus(35, 20, 20);
  await sleep(500);

  let result = await assertPhaseShed("L1", "Step 2");
  if (!result.pass) return false;

  let countAfterFirst = result.shellyStatus.l1_shedding_count;
  if (!check(countAfterFirst === countBefore + 1, "Step 2: shedding count incremented by 1")) return false;

  console.log("\n📤 Step 3: Maintain high current while already shed (35A)...");
  await injectStatus(35, 20, 20);
  await sleep(500);
  await injectStatus(35, 20, 20);
  await sleep(500);

  let shellyStatus = await getShellyStatus();
  if (
    !check(
      shellyStatus.l1_shedding_count === countAfterFirst,
      "Step 3: shedding count NOT incremented again (still shed)"
    )
  )
    return false;
  if (!check(shellyStatus.l1_shedding, "Step 3: L1 still shed")) return false;

  return true;
}

// ============================================================================
// SCENARIO 13: Restoration Delay Respected
// ============================================================================
async function scenario13_restorationDelay() {
  printHeader("SCENARIO 13: Restoration only after full delay");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log("\n📤 Step 2: Trigger immediate shedding on L3 (35A)...");
  await injectStatus(20, 20, 35);
  await sleep(500);

  let result = await assertPhaseShed("L3", "Step 2");
  if (!result.pass) return false;

  console.log("\n📤 Step 3: Immediately drop to normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  let shellyStatus = await getShellyStatus();
  // Should still be shed - restoration delay (10s) not elapsed yet
  if (!check(shellyStatus.l3_shedding, "Step 3: L3 still shed (restoration delay not elapsed, only ~1s)")) return false;

  console.log("\n⏳ Step 4: Wait 5s more (total ~6s, still under 10s delay)...");
  await sleep(5000);
  await injectStatus(20, 20, 20);
  await sleep(500);

  shellyStatus = await getShellyStatus();
  if (!check(shellyStatus.l3_shedding, "Step 4: L3 still shed (~6s < 10s restoration delay)")) return false;

  console.log("\n⏳ Step 5: Wait remaining time for restoration (5s more)...");
  await sleep(5000);
  await injectStatus(20, 20, 20);
  await sleep(1000);

  shellyStatus = await getShellyStatus();
  let mockStatus = await getMockServerStatus();
  if (!check(!shellyStatus.l3_shedding, "Step 5: L3 restored after full 10s delay")) {
    await printStatus(shellyStatus, mockStatus);
    return false;
  }
  if (!check(mockStatus.relays[2], "Step 5: L3 relay back ON")) return false;

  return true;
}

// ============================================================================
// SCENARIO 14: Mixed Phase Shedding (normal + immediate simultaneously)
// ============================================================================
async function scenario14_mixedPhaseShedding() {
  printHeader("SCENARIO 14: Mixed shedding - L1 normal + L2 immediate simultaneously");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log("\n📤 Step 2: L1 overload (29A) + L2 critical overload (35A)...");
  await injectStatus(29, 35, 20);
  await sleep(500);

  let shellyStatus = await getShellyStatus();
  let mockStatus = await getMockServerStatus();

  // L2 should be shed immediately
  if (!check(shellyStatus.l2_shedding, "Step 2: L2 shed immediately (35A > 33.6A)")) {
    await printStatus(shellyStatus, mockStatus);
    return false;
  }
  if (!check(!mockStatus.relays[1], "Step 2: L2 relay OFF")) return false;

  // L1 should be overloaded but NOT yet shed (delay not elapsed)
  if (!check(shellyStatus.l1_overload, "Step 2: L1 is overloaded")) return false;
  if (!check(!shellyStatus.l1_shedding, "Step 2: L1 NOT yet shed (delay pending)")) return false;
  if (!check(mockStatus.relays[0], "Step 2: L1 relay still ON")) return false;

  // L3 should be completely unaffected
  if (!check(!shellyStatus.l3_shedding && !shellyStatus.l3_overload, "Step 2: L3 unaffected")) return false;

  console.log("\n⏳ Step 3: Waiting for L1 shedding delay (2.5s)...");
  await sleep(2500);

  console.log("\n📤 Step 4: Maintaining overload...");
  await injectStatus(29, 35, 20);
  await sleep(500);

  shellyStatus = await getShellyStatus();
  mockStatus = await getMockServerStatus();

  // Now both L1 and L2 should be shed
  if (!check(shellyStatus.l1_shedding, "Step 4: L1 now shed after delay")) return false;
  if (!check(!mockStatus.relays[0], "Step 4: L1 relay OFF")) return false;
  if (!check(shellyStatus.l2_shedding, "Step 4: L2 still shed")) return false;
  if (!check(!shellyStatus.l3_shedding, "Step 4: L3 still unaffected")) return false;

  return true;
}

// ============================================================================
// SCENARIO 15: Relay Sync on Pro3 Reconnection (desync correction)
// ============================================================================
async function scenario15_relaySyncOnReconnect() {
  printHeader("SCENARIO 15: Relay synchronization after Pro3 reconnection");
  await resetState();

  // --- PART A: Shedding while Pro3 offline → relay synced to OFF on reconnect ---

  console.log("\n--- Part A: Shedding occurs while Pro3 is offline ---");

  console.log("\n📤 Step 1: Verify normal state (Pro3 online, all relays ON)...");
  let shellyStatus = await getShellyStatus();
  let mockStatus = await getMockServerStatus();
  if (!check(shellyStatus.pro3_online, "A.1: Pro3 is online")) return false;
  if (!check(mockStatus.relays[0], "A.1: L1 relay is ON on mock")) return false;

  console.log("\n📤 Step 2: Take Pro3 offline...");
  await setMockOnline(false);
  await sleep(15000); // Wait for heartbeat failure detection

  shellyStatus = await getShellyStatus();
  if (!check(!shellyStatus.pro3_online, "A.2: Pro3 detected as offline")) return false;

  console.log("\n📤 Step 3: Trigger shedding on L1 while Pro3 is offline (35A)...");
  await injectStatus(35, 20, 20);
  await sleep(500);

  shellyStatus = await getShellyStatus();
  // Load-shedder should mark L1 as shed (active=false), but relay command failed
  if (!check(shellyStatus.l1_shedding, "A.3: L1 is marked as shed in load-shedder")) return false;
  // Relay status should be unknown (command couldn't be sent)
  if (!check(shellyStatus.l1_relay_status === "unknown", "A.3: L1 relay status is unknown (command failed)"))
    return false;

  // On the mock server, relay 0 is still ON (command never reached it)
  mockStatus = await getMockServerStatus();
  if (!check(mockStatus.relays[0], "A.3: L1 relay still ON on mock (command never sent)")) return false;

  console.log("\n📤 Step 4: Bring Pro3 back online...");
  await setMockOnline(true);

  console.log("\n⏳ Step 5: Waiting for heartbeat recovery + sync (15s)...");
  await sleep(15000);

  shellyStatus = await getShellyStatus();
  mockStatus = await getMockServerStatus();
  if (!check(shellyStatus.pro3_online, "A.5: Pro3 is back online")) return false;
  // After sync, relay should be OFF (matching desired shed state)
  if (!check(!mockStatus.relays[0], "A.5: L1 relay synced to OFF on mock (desync corrected)")) return false;
  if (!check(shellyStatus.l1_relay_status === "off", 'A.5: L1 relay status is "off"')) return false;

  // --- PART B: Restoration while Pro3 offline → relay synced to ON on reconnect ---

  console.log("\n--- Part B: Restoration occurs while Pro3 is offline ---");

  // L1 is currently shed from Part A, wait for restoration delay
  console.log("\n⏳ Step 6: Waiting for restoration delay (10s)...");
  await sleep(10000);
  // Inject normal current to trigger restoration
  await injectStatus(20, 20, 20);
  await sleep(1000);

  // Confirm L1 is restored in load-shedder
  shellyStatus = await getShellyStatus();
  if (!check(!shellyStatus.l1_shedding, "B.6: L1 is restored in load-shedder")) return false;

  // Now shed L1 again for Part B setup
  console.log("\n📤 Step 7: Shed L1 again for Part B setup (35A)...");
  await injectStatus(35, 20, 20);
  await sleep(500);

  shellyStatus = await getShellyStatus();
  if (!check(shellyStatus.l1_shedding, "B.7: L1 is shed again")) return false;

  // Take Pro3 offline
  console.log("\n📤 Step 8: Take Pro3 offline again...");
  await setMockOnline(false);
  await sleep(15000);

  shellyStatus = await getShellyStatus();
  if (!check(!shellyStatus.pro3_online, "B.8: Pro3 is offline")) return false;

  // Wait for restoration delay, then inject normal current to trigger restoration
  console.log("\n⏳ Step 9: Wait for restoration delay (10s) while offline...");
  await sleep(10000);
  await injectStatus(20, 20, 20);
  await sleep(1000);

  shellyStatus = await getShellyStatus();
  // Load-shedder wants L1 ON (active=true), but command failed
  if (!check(!shellyStatus.l1_shedding, "B.9: L1 marked as restored in load-shedder")) return false;
  if (!check(shellyStatus.l1_relay_status === "unknown", "B.9: L1 relay status unknown (command failed)")) return false;

  // On mock, relay is still OFF (from Part A shedding, command to turn ON never reached)
  mockStatus = await getMockServerStatus();
  if (!check(!mockStatus.relays[0], "B.9: L1 relay still OFF on mock (ON command never sent)")) return false;

  console.log("\n📤 Step 10: Bring Pro3 back online...");
  await setMockOnline(true);

  console.log("\n⏳ Step 11: Waiting for heartbeat recovery + sync (15s)...");
  await sleep(15000);

  shellyStatus = await getShellyStatus();
  mockStatus = await getMockServerStatus();
  if (!check(shellyStatus.pro3_online, "B.11: Pro3 is back online")) return false;
  // After sync, relay should be ON (matching desired restored state)
  if (!check(mockStatus.relays[0], "B.11: L1 relay synced to ON on mock (desync corrected)")) return false;
  if (!check(shellyStatus.l1_relay_status === "on", 'B.11: L1 relay status is "on"')) return false;

  return true;
}

// ============================================================================
// SCENARIO 16: Ethernet Loss → Pro3 Emergency Shutdown → Full Recovery
// ============================================================================
async function scenario16_ethernetEmergencyRecovery() {
  printHeader("SCENARIO 16: Ethernet loss → Pro3 emergency shutdown → full resync");
  await resetState();

  console.log("\n📤 Step 1: Verify normal state (all relays ON, Pro3 online)...");
  let { pass: initialPass } = await assertNormalState("Step 1");
  if (!initialPass) return false;
  let shellyStatus = await getShellyStatus();
  if (!check(shellyStatus.pro3_online, "Step 1: Pro3 is online")) return false;

  console.log("\n📤 Step 2: Simulate ethernet disconnection...");
  await injectETH(false);
  await sleep(2000);

  shellyStatus = await getShellyStatus();
  if (!check(!shellyStatus.pro3_online, "Step 2: Pro3 detected as offline (heartbeat stopped)")) return false;

  console.log("\n📤 Step 3: Simulate Pro3 emergency shutdown (all relays OFF after 60s timeout)...");
  console.log("   (In production, safety-protection.js does this automatically)");
  await setMockRelay(0, false);
  await setMockRelay(1, false);
  await setMockRelay(2, false);
  await sleep(500);

  let mockStatus = await getMockServerStatus();
  if (
    !check(
      !mockStatus.relays[0] && !mockStatus.relays[1] && !mockStatus.relays[2],
      "Step 3: All relays OFF on mock (emergency shutdown simulated)"
    )
  )
    return false;

  // Load-shedder still wants all phases ON (active=true, no overload)
  shellyStatus = await getShellyStatus();
  if (
    !check(
      !shellyStatus.l1_shedding && !shellyStatus.l2_shedding && !shellyStatus.l3_shedding,
      "Step 3: Load-shedder still wants all phases active (no shedding)"
    )
  )
    return false;

  console.log("\n📤 Step 4: Simulate ethernet reconnection...");
  await injectETH(true);

  console.log("\n⏳ Step 5: Waiting for heartbeat recovery + relay sync (15s)...");
  await sleep(15000);

  shellyStatus = await getShellyStatus();
  mockStatus = await getMockServerStatus();
  if (!check(shellyStatus.pro3_online, "Step 5: Pro3 is back online")) return false;

  // After sync: desired=ON for all, actual was OFF → all should be turned ON
  if (!check(mockStatus.relays[0], "Step 5: L1 relay synced back to ON")) return false;
  if (!check(mockStatus.relays[1], "Step 5: L2 relay synced back to ON")) return false;
  if (!check(mockStatus.relays[2], "Step 5: L3 relay synced back to ON")) return false;

  if (!check(shellyStatus.l1_relay_status === "on", 'Step 5: L1 relay status is "on"')) return false;
  if (!check(shellyStatus.l2_relay_status === "on", 'Step 5: L2 relay status is "on"')) return false;
  if (!check(shellyStatus.l3_relay_status === "on", 'Step 5: L3 relay status is "on"')) return false;

  return true;
}

// ============================================================================
// SCENARIO 17: Re-overload during restoration wait
// ============================================================================
async function scenario17_reOverloadDuringRestore() {
  printHeader("SCENARIO 17: Current bounces back up during restoration wait");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  let statusBefore = await getShellyStatus();
  let countBefore = statusBefore.l1_shedding_count;

  console.log("\n📤 Step 2: Trigger immediate shedding on L1 (35A)...");
  await injectStatus(35, 20, 20);
  await sleep(500);

  let result = await assertPhaseShed("L1", "Step 2");
  if (!result.pass) return false;

  if (
    !check(result.shellyStatus.l1_shedding_count === countBefore + 1, "Step 2: shedding count = " + (countBefore + 1))
  )
    return false;

  console.log("\n📤 Step 3: Current drops briefly to 20A (below threshold)...");
  await injectStatus(20, 20, 20);
  await sleep(2000); // Only 2s into the 10s restoration delay

  let shellyStatus = await getShellyStatus();
  if (!check(shellyStatus.l1_shedding, "Step 3: L1 still shed (only 2s into 10s delay)")) return false;

  console.log("\n📤 Step 4: Current goes back UP to 29A while still shed...");
  await injectStatus(29, 20, 20);
  await sleep(1000);

  shellyStatus = await getShellyStatus();
  // Phase should still be shed - re-overload while shed should NOT trigger new shedding
  if (!check(shellyStatus.l1_shedding, "Step 4: L1 still shed")) return false;
  if (
    !check(shellyStatus.l1_shedding_count === countBefore + 1, "Step 4: shedding count unchanged (no double shedding)")
  )
    return false;

  console.log("\n⏳ Step 5: Wait for restoration delay to expire (10s)...");
  await sleep(10000);

  console.log("\n📤 Step 6: Re-inject high current (still 29A)...");
  await injectStatus(29, 20, 20);
  await sleep(500);

  shellyStatus = await getShellyStatus();
  // Current is above shedding threshold, so restoration should NOT happen
  // The phase should remain shed because current > SHEDDING_THRESHOLD
  if (!check(shellyStatus.l1_shedding, "Step 6: L1 NOT restored (29A > 28A threshold, restoration blocked)"))
    return false;

  console.log("\n📤 Step 7: NOW drop to normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  shellyStatus = await getShellyStatus();
  let mockStatus = await getMockServerStatus();
  // NOW restoration should happen (delay already elapsed + current below threshold)
  if (!check(!shellyStatus.l1_shedding, "Step 7: L1 restored (delay elapsed + current below threshold)")) {
    await printStatus(shellyStatus, mockStatus);
    return false;
  }
  if (!check(mockStatus.relays[0], "Step 7: L1 relay back ON")) return false;

  return true;
}

// ============================================================================
// SCENARIO 18: Rapid shed → restore → shed cycle
// ============================================================================
async function scenario18_rapidCycle() {
  printHeader("SCENARIO 18: Rapid shed-restore-shed cycle");
  await resetState();

  console.log("\n📤 Step 1: Normal current (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  let statusBefore = await getShellyStatus();
  let countBefore = statusBefore.l2_shedding_count;

  // --- First shedding ---
  console.log("\n📤 Step 2: First shedding - immediate on L2 (35A)...");
  await injectStatus(20, 35, 20);
  await sleep(500);

  let result = await assertPhaseShed("L2", "Step 2 - First shed");
  if (!result.pass) return false;
  if (
    !check(result.shellyStatus.l2_shedding_count === countBefore + 1, "Step 2: shedding count = " + (countBefore + 1))
  )
    return false;

  // --- Wait and restore ---
  console.log("\n⏳ Step 3: Waiting for restoration delay (10s)...");
  await sleep(10000);

  console.log("\n📤 Step 4: Drop to normal current to trigger restoration (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  let shellyStatus = await getShellyStatus();
  let mockStatus = await getMockServerStatus();
  if (!check(!shellyStatus.l2_shedding, "Step 4: L2 restored")) {
    await printStatus(shellyStatus, mockStatus);
    return false;
  }
  if (!check(mockStatus.relays[1], "Step 4: L2 relay back ON")) return false;

  // --- Second shedding immediately after restore ---
  console.log("\n📤 Step 5: Immediately re-overload L2 (35A) after restoration...");
  await injectStatus(20, 35, 20);
  await sleep(500);

  result = await assertPhaseShed("L2", "Step 5 - Second shed");
  if (!result.pass) return false;
  if (
    !check(
      result.shellyStatus.l2_shedding_count === countBefore + 2,
      "Step 5: shedding count = " + (countBefore + 2) + " (incremented again)"
    )
  )
    return false;

  // --- Wait and restore again ---
  console.log("\n⏳ Step 6: Waiting for restoration delay (10s)...");
  await sleep(10000);

  console.log("\n📤 Step 7: Drop to normal again (20A)...");
  await injectStatus(20, 20, 20);
  await sleep(1000);

  shellyStatus = await getShellyStatus();
  mockStatus = await getMockServerStatus();
  if (!check(!shellyStatus.l2_shedding, "Step 7: L2 restored again")) {
    await printStatus(shellyStatus, mockStatus);
    return false;
  }
  if (!check(mockStatus.relays[1], "Step 7: L2 relay back ON")) return false;
  if (!check(shellyStatus.l2_shedding_count === countBefore + 2, "Step 7: final shedding count = " + (countBefore + 2)))
    return false;

  return true;
}

// ============================================================================
// Interactive Menu
// ============================================================================
async function showMenu() {
  console.log("\n╔" + "═".repeat(78) + "╗");
  console.log("║" + " ".repeat(20) + "LOAD-SHEDDER TEST SCENARIOS" + " ".repeat(31) + "║");
  console.log("╚" + "═".repeat(78) + "╝\n");
  console.log(`🎯 Target Shelly: ${SHELLY_BASE_URL}`);
  console.log(`📝 Script ID: ${SHELLY_SCRIPT_ID}`);
  console.log(`🔗 Inject endpoint: ${INJECT_ENDPOINT}\n`);
  console.log("⚠️  Prerequisites:");
  console.log("   1. Set TEST_MODE=true in load-shedder.js CONFIG");
  console.log("   2. Deploy load-shedder.js to Shelly");
  console.log("   3. Start Pro3 mock server: node test-server.js");
  console.log("   4. Set PRO3_IP in load-shedder.js to mock server (e.g., 192.168.1.200:3100)\n");
  console.log("📌 Configuration:");
  console.log(`   Set SHELLY_IP env var to change target (current: ${SHELLY_IP})`);
  console.log(`   Set SHELLY_SCRIPT_ID to change script ID (current: ${SHELLY_SCRIPT_ID})\n`);
  console.log("Available scenarios:");
  console.log("   1  - Normal Operation");
  console.log("   2  - Progressive Overload");
  console.log("   3  - Immediate Shedding");
  console.log("   5  - Pro3 Connection Loss");
  console.log("   6  - Multi-Phase Overload");
  console.log("   7  - Overload Cancellation");
  console.log("   8  - Ethernet Disconnection");
  console.log("   9  - Ethernet Reconnection");
  console.log("   10 - Hysteresis (between thresholds)");
  console.log("   11 - Threshold Edge Cases");
  console.log("   12 - Double Shedding Prevention");
  console.log("   13 - Restoration Delay Respected");
  console.log("   14 - Mixed Phase Shedding");
  console.log("   15 - Relay Sync on Pro3 Reconnect");
  console.log("   16 - Ethernet Emergency Recovery");
  console.log("   17 - Re-overload During Restore");
  console.log("   18 - Rapid Shed-Restore Cycle");
  console.log("   A  - Run all scenarios");
  console.log("   Q  - Quit\n");
}

async function runScenario(choice) {
  try {
    switch (choice) {
      case "1":
        return await scenario1_normalOperation();
      case "2":
        return await scenario2_progressiveOverload();
      case "3":
        return await scenario3_immediateShedding();
      case "5":
        return await scenario5_pro3Offline();
      case "6":
        return await scenario6_multiPhaseOverload();
      case "7":
        return await scenario7_overloadCancellation();
      case "8":
        return await scenario8_ethernetDisconnection();
      case "9":
        return await scenario9_ethernetReconnection();
      case "10":
        return await scenario10_hysteresis();
      case "11":
        return await scenario11_thresholdEdge();
      case "12":
        return await scenario12_doubleShedding();
      case "13":
        return await scenario13_restorationDelay();
      case "14":
        return await scenario14_mixedPhaseShedding();
      case "15":
        return await scenario15_relaySyncOnReconnect();
      case "16":
        return await scenario16_ethernetEmergencyRecovery();
      case "17":
        return await scenario17_reOverloadDuringRestore();
      case "18":
        return await scenario18_rapidCycle();
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
    { name: "Scenario 1: Normal Operation", fn: scenario1_normalOperation },
    { name: "Scenario 2: Progressive Overload", fn: scenario2_progressiveOverload },
    { name: "Scenario 3: Immediate Shedding", fn: scenario3_immediateShedding },
    { name: "Scenario 5: Pro3 Offline", fn: scenario5_pro3Offline },
    { name: "Scenario 6: Multi-Phase Overload", fn: scenario6_multiPhaseOverload },
    { name: "Scenario 7: Overload Cancellation", fn: scenario7_overloadCancellation },
    { name: "Scenario 8: Ethernet Disconnection", fn: scenario8_ethernetDisconnection },
    { name: "Scenario 9: Ethernet Reconnection", fn: scenario9_ethernetReconnection },
    { name: "Scenario 10: Hysteresis", fn: scenario10_hysteresis },
    { name: "Scenario 11: Threshold Edge Cases", fn: scenario11_thresholdEdge },
    { name: "Scenario 12: Double Shedding Prevention", fn: scenario12_doubleShedding },
    { name: "Scenario 13: Restoration Delay", fn: scenario13_restorationDelay },
    { name: "Scenario 14: Mixed Phase Shedding", fn: scenario14_mixedPhaseShedding },
    { name: "Scenario 15: Relay Sync on Reconnect", fn: scenario15_relaySyncOnReconnect },
    { name: "Scenario 16: Ethernet Emergency Recovery", fn: scenario16_ethernetEmergencyRecovery },
    { name: "Scenario 17: Re-overload During Restore", fn: scenario17_reOverloadDuringRestore },
    { name: "Scenario 18: Rapid Shed-Restore Cycle", fn: scenario18_rapidCycle }
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
    // Run specific scenario from command line
    await runScenario(args[0].toUpperCase());
  } else {
    // Interactive mode
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

// Export for use as module
module.exports = {
  // Scenarios
  scenario1_normalOperation,
  scenario2_progressiveOverload,
  scenario3_immediateShedding,
  scenario5_pro3Offline,
  scenario6_multiPhaseOverload,
  scenario7_overloadCancellation,
  scenario8_ethernetDisconnection,
  scenario9_ethernetReconnection,
  scenario10_hysteresis,
  scenario11_thresholdEdge,
  scenario12_doubleShedding,
  scenario13_restorationDelay,
  scenario14_mixedPhaseShedding,
  scenario15_relaySyncOnReconnect,
  scenario16_ethernetEmergencyRecovery,
  scenario17_reOverloadDuringRestore,
  scenario18_rapidCycle,
  runAllScenarios,

  // Injection helpers
  injectStatus,
  injectETH,

  // Status & control helpers
  getShellyStatus,
  getMockServerStatus,
  setMockRelay,
  setMockOnline,
  resetState,
  printStatus
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
