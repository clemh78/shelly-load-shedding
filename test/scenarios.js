/**
 * TEST SCENARIOS - Tests real Shelly with TEST_MODE
 * Injects status via HTTP endpoint on real Shelly Pro 3EM
 */

const axios = require('axios');

// Configuration
const SHELLY_IP = process.env.SHELLY_IP || "192.168.1.100";
const SHELLY_SCRIPT_ID = process.env.SHELLY_SCRIPT_ID || "1";
const SHELLY_BASE_URL = `http://${SHELLY_IP}`;
const INJECT_ENDPOINT = `${SHELLY_BASE_URL}/script/${SHELLY_SCRIPT_ID}/inject-status`;
const GET_STATUS_ENDPOINT = `${SHELLY_BASE_URL}/script/${SHELLY_SCRIPT_ID}/get-status`;
const MOCK_SERVER_URL = process.env.MOCK_SERVER_URL || "http://localhost:3100";

// Helper functions
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    if (error.code === 'ECONNREFUSED') {
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
    console.log(`   📤 ETH status: ${connected ? 'CONNECTED' : 'DISCONNECTED'}`);
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
    return response.data;
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
    console.log(`   🔧 Mock relay ${relayId} set to ${state ? 'ON' : 'OFF'}`);
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
    console.log(`   🔧 Mock server set to ${online ? 'ONLINE' : 'OFFLINE'}`);
    return response.data;
  } catch (error) {
    console.error(`   ❌ Failed to set mock online state: ${error.message}`);
    throw error;
  }
}

/**
 * Print detailed status from both Shelly and Mock Server
 */
async function printStatus() {
  console.log('\n📊 Current Status:');

  try {
    const shellyStatus = await getShellyStatus();
    const mockStatus = await getMockServerStatus();

    console.log('\n🔌 Shelly Load-Shedder:');
    console.log(`   Network: ${shellyStatus.state.network.connected ? '✅ Connected' : '❌ Disconnected'}`);
    console.log(`   Pro3: ${shellyStatus.state.pro3.online ? '✅ Online' : '❌ Offline'}`);

    console.log('\n   L1:');
    console.log(`     State: ${shellyStatus.state.l1.state}`);
    console.log(`     Current: ${shellyStatus.state.l1.current}A`);
    console.log(`     Relay (desired): ${shellyStatus.state.pro3.relays.l1}`);
    console.log(`     Shedding count: ${shellyStatus.state.l1.sheddingCount}`);

    console.log('\n   L2:');
    console.log(`     State: ${shellyStatus.state.l2.state}`);
    console.log(`     Current: ${shellyStatus.state.l2.current}A`);
    console.log(`     Relay (desired): ${shellyStatus.state.pro3.relays.l2}`);
    console.log(`     Shedding count: ${shellyStatus.state.l2.sheddingCount}`);

    console.log('\n   L3:');
    console.log(`     State: ${shellyStatus.state.l3.state}`);
    console.log(`     Current: ${shellyStatus.state.l3.current}A`);
    console.log(`     Relay (desired): ${shellyStatus.state.pro3.relays.l3}`);
    console.log(`     Shedding count: ${shellyStatus.state.l3.sheddingCount}`);

    console.log('\n🔌 Mock Server (Pro3):');
    console.log(`   Online: ${mockStatus.online ? '✅' : '❌'}`);
    console.log(`   Relay 0 (L1): ${mockStatus.relays[0] ? '✅ ON' : '❌ OFF'}`);
    console.log(`   Relay 1 (L2): ${mockStatus.relays[1] ? '✅ ON' : '❌ OFF'}`);
    console.log(`   Relay 2 (L3): ${mockStatus.relays[2] ? '✅ ON' : '❌ OFF'}`);

  } catch (error) {
    console.error('   ❌ Failed to get status:', error.message);
  }
}

function printHeader(title) {
  console.log('\n' + '='.repeat(80));
  console.log(title);
  console.log('='.repeat(80));
}

function checkResult(condition, message) {
  const status = condition ? '✅' : '❌';
  console.log(`   ${status} ${message}`);
  return condition;
}

// ============================================================================
// SCENARIO 1: Normal Operation
// ============================================================================
async function scenario1_normalOperation() {
  printHeader('SCENARIO 1: Normal Operation (below threshold)');

  console.log('\n📤 Injecting normal currents (20A on all phases)...');
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log('\n📋 Expected results:');
  console.log('   - All phases should remain ON');
  console.log('   - No overload detected');
  console.log('   - No shedding events');

  console.log('\n💡 Check Shelly logs and MQTT messages to verify');
  return true;
}

// ============================================================================
// SCENARIO 2: Progressive Overload
// ============================================================================
async function scenario2_progressiveOverload() {
  printHeader('SCENARIO 2: Progressive Overload and Normal Shedding');

  console.log('\n📤 Step 1: Normal current (20A)...');
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log('\n📤 Step 2: Overloading L1 to 29A (above 28A threshold)...');
  await injectStatus(29, 20, 20);
  await sleep(500);

  console.log('\n📋 At this point:');
  console.log('   - L1 should be marked as OVERLOAD');
  console.log('   - L1 should still be ON (waiting for delay)');

  console.log('\n⏳ Step 3: Waiting for shedding delay (2.5s)...');
  await sleep(2500);

  console.log('\n📤 Step 4: Maintaining overload (29A)...');
  await injectStatus(29, 20, 20);
  await sleep(500);

  console.log('\n📋 Expected results:');
  console.log('   - L1 should be SHED (OFF)');
  console.log('   - L1 relay should be OFF');
  console.log('   - MQTT event "normal_shedding" published');
  console.log('   - Shedding count incremented');

  console.log('\n💡 Check Shelly logs and MQTT messages to verify');
  return true;
}

// ============================================================================
// SCENARIO 3: Immediate Shedding
// ============================================================================
async function scenario3_immediateShedding() {
  printHeader('SCENARIO 3: Immediate Shedding (>120% threshold)');

  console.log('\n📤 Step 1: Normal current (20A)...');
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log('\n📤 Step 2: Critical overload on L2 (35A > 33.6A immediate threshold)...');
  await injectStatus(20, 35, 20);
  await sleep(1000);

  console.log('\n📋 Expected results:');
  console.log('   - L2 should be SHED IMMEDIATELY (no delay)');
  console.log('   - L2 relay should be OFF');
  console.log('   - MQTT event "immediate_shedding" published');

  console.log('\n💡 Check Shelly logs and MQTT messages to verify');
  return true;
}

// ============================================================================
// SCENARIO 4: Restoration (Note: requires 5min wait by default)
// ============================================================================
async function scenario4_restoration() {
  printHeader('SCENARIO 4: Restoration After Delay');

  console.log('\n📤 Step 1: Trigger immediate shedding on L3 (35A)...');
  await injectStatus(20, 20, 35);
  await sleep(1000);

  console.log('\n📋 L3 should be SHED');

  console.log('\n📤 Step 2: Reduce L3 current to 25A (below 26A restoration threshold)...');
  await injectStatus(20, 20, 25);
  await sleep(1000);

  console.log('\n📋 Expected results:');
  console.log('   - L3 should still be OFF (restoration delay = 5min by default)');
  console.log('   - After 5 minutes of low current, L3 should restore automatically');

  console.log('\n⚠️  Note: Full restoration test requires 5 minutes wait!');
  console.log('   Consider reducing CONFIG.RESTORATION_DELAY for testing.');
  console.log('   Or wait 5 minutes and inject another status update to trigger check.');

  console.log('\n💡 Check Shelly logs and MQTT messages to verify');
  return true;
}

// ============================================================================
// SCENARIO 5: Pro3 Connection Loss
// ============================================================================
async function scenario5_pro3Offline() {
  printHeader('SCENARIO 5: Pro3 Connection Loss and Recovery');

  console.log('\n⚠️  This test requires manually stopping/starting the Pro3 mock server');
  console.log('   Or setting the mock to offline mode via:');
  console.log('   curl -X POST http://localhost:3100/set-online -d \'{"online": false}\'');

  console.log('\n📋 Expected behavior:');
  console.log('   1. When Pro3 heartbeat fails:');
  console.log('      - Pro3 should be marked OFFLINE');
  console.log('      - All relay states should become "unknown"');
  console.log('      - Load shedding logic continues but cannot control relays');
  console.log('   2. When Pro3 comes back:');
  console.log('      - Pro3 marked ONLINE');
  console.log('      - Relay synchronization triggered');
  console.log('      - Relays set to match desired state');

  console.log('\n💡 Monitor Shelly logs to observe the behavior');
  return true;
}

// ============================================================================
// SCENARIO 6: Multi-Phase Overload
// ============================================================================
async function scenario6_multiPhaseOverload() {
  printHeader('SCENARIO 6: Multiple Phase Overload');

  console.log('\n📤 Step 1: Normal current (20A)...');
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log('\n📤 Step 2: Overloading all phases (29A each)...');
  await injectStatus(29, 29, 29);
  await sleep(500);

  console.log('\n📋 All phases should be marked as OVERLOAD');

  console.log('\n⏳ Step 3: Waiting for shedding delay (2.5s)...');
  await sleep(2500);

  console.log('\n📤 Step 4: Maintaining overload...');
  await injectStatus(29, 29, 29);
  await sleep(500);

  console.log('\n📋 Expected results:');
  console.log('   - All three phases should be SHED');
  console.log('   - All three relays should be OFF');
  console.log('   - Three "normal_shedding" events published');

  console.log('\n💡 Check Shelly logs and MQTT messages to verify');
  return true;
}

// ============================================================================
// SCENARIO 7: Overload Cancellation
// ============================================================================
async function scenario7_overloadCancellation() {
  printHeader('SCENARIO 7: Overload Cancellation (current drops before delay)');

  console.log('\n📤 Step 1: Normal current (20A)...');
  await injectStatus(20, 20, 20);
  await sleep(1000);

  console.log('\n📤 Step 2: Overloading L1 to 29A...');
  await injectStatus(29, 20, 20);
  await sleep(500);

  console.log('\n📋 L1 should be marked as OVERLOAD');

  console.log('\n📤 Step 3: Reducing current BEFORE delay expires (1s < 2s delay)...');
  await sleep(1000);
  await injectStatus(25, 20, 20);
  await sleep(500);

  console.log('\n📋 Expected results:');
  console.log('   - L1 overload should be CANCELLED');
  console.log('   - L1 should remain ON (no shedding occurred)');
  console.log('   - No shedding event published');

  console.log('\n💡 Check Shelly logs to verify overload cancellation message');
  return true;
}

// ============================================================================
// SCENARIO 8: Ethernet Disconnection
// ============================================================================
async function scenario8_ethernetDisconnection() {
  printHeader('SCENARIO 8: Ethernet Disconnection');

  console.log('\n📤 Step 1: Simulating Ethernet disconnection...');
  await injectETH(false);
  await sleep(1000);

  console.log('\n📤 Step 2: Setting relay 0 to OFF on mock server...');
  await setMockRelay(0, false);
  await sleep(1000);

  console.log('\n📋 Checking status...');
  await printStatus();

  console.log('\n📋 Expected results:');
  console.log('   - Network disconnection detected');
  console.log('   - MQTT event "network_disconnected" published');
  console.log('   - Relay 0 manually set to OFF on Pro3 mock');

  console.log('\n💡 Check Shelly logs and MQTT messages to verify');
  return true;
}

// ============================================================================
// SCENARIO 9: Ethernet Reconnection
// ============================================================================
async function scenario9_ethernetReconnection() {
  printHeader('SCENARIO 9: Ethernet Reconnection');

  console.log('\n📤 Step 1: Simulating Ethernet reconnection...');
  await injectETH(true);
  await sleep(1000);

  console.log('\n📋 Expected results:');
  console.log('   - Network reconnection detected');
  console.log('   - MQTT event "network_connected" published');
  console.log('   - Pro3 heartbeat should resume');
  console.log('   - Relay synchronization should be triggered');

  console.log('\n💡 Check Shelly logs and MQTT messages to verify');
  return true;
}

// ============================================================================
// Interactive Menu
// ============================================================================
async function showMenu() {
  console.log('\n╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' '.repeat(20) + 'LOAD-SHEDDER TEST SCENARIOS' + ' '.repeat(31) + '║');
  console.log('╚' + '═'.repeat(78) + '╝\n');
  console.log(`🎯 Target Shelly: ${SHELLY_BASE_URL}`);
  console.log(`📝 Script ID: ${SHELLY_SCRIPT_ID}`);
  console.log(`🔗 Inject endpoint: ${INJECT_ENDPOINT}\n`);
  console.log('⚠️  Prerequisites:');
  console.log('   1. Set TEST_MODE=true in load-shedder.js CONFIG');
  console.log('   2. Deploy load-shedder.js to Shelly');
  console.log('   3. Start Pro3 mock server: node test-server.js');
  console.log('   4. Set PRO3_IP in load-shedder.js to mock server (e.g., 192.168.1.200:3100)\n');
  console.log('📌 Configuration:');
  console.log(`   Set SHELLY_IP env var to change target (current: ${SHELLY_IP})`);
  console.log(`   Set SHELLY_SCRIPT_ID to change script ID (current: ${SHELLY_SCRIPT_ID})\n`);
  console.log('Available scenarios:');
  console.log('   1 - Normal Operation');
  console.log('   2 - Progressive Overload');
  console.log('   3 - Immediate Shedding');
  console.log('   4 - Restoration');
  console.log('   5 - Pro3 Connection Loss');
  console.log('   6 - Multi-Phase Overload');
  console.log('   7 - Overload Cancellation');
  console.log('   8 - Ethernet Disconnection');
  console.log('   9 - Ethernet Reconnection');
  console.log('   A - Run all scenarios');
  console.log('   Q - Quit\n');
}

async function runScenario(choice) {
  try {
    switch(choice) {
      case '1':
        await scenario1_normalOperation();
        break;
      case '2':
        await scenario2_progressiveOverload();
        break;
      case '3':
        await scenario3_immediateShedding();
        break;
      case '4':
        await scenario4_restoration();
        break;
      case '5':
        await scenario5_pro3Offline();
        break;
      case '6':
        await scenario6_multiPhaseOverload();
        break;
      case '7':
        await scenario7_overloadCancellation();
        break;
      case '8':
        await scenario8_ethernetDisconnection();
        break;
      case '9':
        await scenario9_ethernetReconnection();
        break;
      case 'A':
      case 'a':
        await runAllScenarios();
        break;
      default:
        console.log('❌ Invalid choice');
    }
  } catch (error) {
    console.error('\n❌ Scenario failed:', error.message);
  }
}

async function runAllScenarios() {
  const scenarios = [
    { name: 'Scenario 1: Normal Operation', fn: scenario1_normalOperation },
    { name: 'Scenario 2: Progressive Overload', fn: scenario2_progressiveOverload },
    { name: 'Scenario 3: Immediate Shedding', fn: scenario3_immediateShedding },
    { name: 'Scenario 4: Restoration', fn: scenario4_restoration },
    { name: 'Scenario 5: Pro3 Offline', fn: scenario5_pro3Offline },
    { name: 'Scenario 6: Multi-Phase Overload', fn: scenario6_multiPhaseOverload },
    { name: 'Scenario 7: Overload Cancellation', fn: scenario7_overloadCancellation },
    { name: 'Scenario 8: Ethernet Disconnection', fn: scenario8_ethernetDisconnection },
    { name: 'Scenario 9: Ethernet Reconnection', fn: scenario9_ethernetReconnection }
  ];

  console.log('\n🚀 Running all scenarios...\n');

  for (const scenario of scenarios) {
    try {
      await scenario.fn();
      console.log(`\n✅ ${scenario.name} completed`);
      await sleep(3000); // Pause between scenarios
    } catch (error) {
      console.log(`\n❌ ${scenario.name} failed: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('All scenarios completed!');
  console.log('Review Shelly logs and MQTT messages to verify results.');
  console.log('='.repeat(80) + '\n');
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
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const askQuestion = () => {
      showMenu();
      rl.question('Choose scenario: ', async (answer) => {
        if (answer.toUpperCase() === 'Q') {
          console.log('👋 Goodbye!\n');
          rl.close();
          return;
        }

        await runScenario(answer);

        console.log('\n' + '─'.repeat(80));
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
  scenario4_restoration,
  scenario5_pro3Offline,
  scenario6_multiPhaseOverload,
  scenario7_overloadCancellation,
  scenario8_ethernetDisconnection,
  scenario9_ethernetReconnection,
  runAllScenarios,

  // Injection helpers
  injectStatus,
  injectETH,

  // Status & control helpers
  getShellyStatus,
  getMockServerStatus,
  setMockRelay,
  setMockOnline,
  printStatus
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
