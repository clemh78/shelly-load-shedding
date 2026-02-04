/******************************************************************************
 * HOME ASSISTANT AUTO-DISCOVERY FOR LOAD SHEDDING
 *
 * Standalone script to publish HA discovery configs.
 * Run once after deploying pro3em.js, or when config changes.
 *
 * Installation: Shelly Pro 3EM -> Settings -> Scripts -> Add Script
 * Run manually, then disable/delete (discovery is retained by HA)
 ******************************************************************************/

let CONFIG = {
  VERSION: "1.7",
  MQTT_TOPIC_PREFIX: "load-shedding-dev",
  PUBLISH_DELAY: 300
};

let prefix = CONFIG.MQTT_TOPIC_PREFIX;
let idPrefix = prefix.split("-").join("_");  // Sanitize for HA identifiers (no dashes)
let deviceInfo = {
  identifiers: [prefix],
  name: "Load Shedder (" + prefix + ")",
  model: "Custom Shelly",
  manufacturer: "DIY",
  sw_version: CONFIG.VERSION
};
let onlineTopic = Shelly.getDeviceInfo().id + "/online";

let step = 0;
let ok = 0;
let fail = 0;

function pub(topic, config) {
  let r = MQTT.publish("homeassistant/" + topic, JSON.stringify(config), 0, true);
  if (r) { ok++; } else { fail++; print("FAIL: " + topic); }
}

function next() {
  step++;

  // L1 (steps 1-6)
  if (step === 1) {
    pub("binary_sensor/" + idPrefix + "/l1_overload/config", {
      name: "L1 Overload", object_id: idPrefix + "_l1_overload", unique_id: idPrefix + "_overload_l1",
      state_topic: prefix + "/L1/state", value_template: "{{ value_json.params.data.overload }}",
      payload_on: "True", payload_off: "False", device_class: "problem", device: deviceInfo,
      availability_topic: onlineTopic, payload_available: "true", payload_not_available: "false"
    });
  } else if (step === 2) {
    pub("binary_sensor/" + idPrefix + "/l1_shedding/config", {
      name: "L1 Shedding", object_id: idPrefix + "_l1_shedding", unique_id: idPrefix + "_shedding_l1",
      state_topic: prefix + "/L1/state", value_template: "{{ value_json.params.data.shedding }}",
      payload_on: "True", payload_off: "False", device_class: "problem", device: deviceInfo,
      availability_topic: onlineTopic, payload_available: "true", payload_not_available: "false"
    });
  } else if (step === 3) {
    pub("sensor/" + idPrefix + "/l1_current/config", {
      name: "L1 Current", object_id: idPrefix + "_l1_current", unique_id: idPrefix + "_current_l1",
      state_topic: prefix + "/L1/state", value_template: "{{ value_json.params.data.current }}",
      unit_of_measurement: "A", device_class: "current", state_class: "measurement", expire_after: 30, device: deviceInfo
    });
  } else if (step === 4) {
    pub("sensor/" + idPrefix + "/l1_last_shedding/config", {
      name: "L1 Last Shedding", object_id: idPrefix + "_l1_last_shedding", unique_id: idPrefix + "_last_shedding_l1",
      state_topic: prefix + "/L1/state",
      value_template: "{% set ts = value_json.params.data.last_shedding %}{{ (ts / 1000) | timestamp_utc if ts else None }}",
      device_class: "timestamp", device: deviceInfo
    });
  } else if (step === 5) {
    pub("sensor/" + idPrefix + "/l1_shedding_count/config", {
      name: "L1 Shedding Count", object_id: idPrefix + "_l1_shedding_count", unique_id: idPrefix + "_shedding_count_l1",
      state_topic: prefix + "/L1/state", value_template: "{{ value_json.params.data.shedding_count }}",
      icon: "mdi:counter", state_class: "total_increasing", device: deviceInfo
    });
  } else if (step === 6) {
    pub("binary_sensor/" + idPrefix + "/l1_relay/config", {
      name: "L1 Relay", object_id: idPrefix + "_l1_relay", unique_id: idPrefix + "_relay_status_l1",
      state_topic: prefix + "/L1/state", value_template: "{{ value_json.params.data.relay_status }}",
      payload_on: "on", payload_off: "off", device_class: "power", device: deviceInfo,
      availability_topic: prefix + "/status", availability_template: "{{ 'online' if value_json.params.data.pro3_online else 'offline' }}"
    });
  }
  // L2 (steps 7-12)
  else if (step === 7) {
    pub("binary_sensor/" + idPrefix + "/l2_overload/config", {
      name: "L2 Overload", object_id: idPrefix + "_l2_overload", unique_id: idPrefix + "_overload_l2",
      state_topic: prefix + "/L2/state", value_template: "{{ value_json.params.data.overload }}",
      payload_on: "True", payload_off: "False", device_class: "problem", device: deviceInfo,
      availability_topic: onlineTopic, payload_available: "true", payload_not_available: "false"
    });
  } else if (step === 8) {
    pub("binary_sensor/" + idPrefix + "/l2_shedding/config", {
      name: "L2 Shedding", object_id: idPrefix + "_l2_shedding", unique_id: idPrefix + "_shedding_l2",
      state_topic: prefix + "/L2/state", value_template: "{{ value_json.params.data.shedding }}",
      payload_on: "True", payload_off: "False", device_class: "problem", device: deviceInfo,
      availability_topic: onlineTopic, payload_available: "true", payload_not_available: "false"
    });
  } else if (step === 9) {
    pub("sensor/" + idPrefix + "/l2_current/config", {
      name: "L2 Current", object_id: idPrefix + "_l2_current", unique_id: idPrefix + "_current_l2",
      state_topic: prefix + "/L2/state", value_template: "{{ value_json.params.data.current }}",
      unit_of_measurement: "A", device_class: "current", state_class: "measurement", expire_after: 30, device: deviceInfo
    });
  } else if (step === 10) {
    pub("sensor/" + idPrefix + "/l2_last_shedding/config", {
      name: "L2 Last Shedding", object_id: idPrefix + "_l2_last_shedding", unique_id: idPrefix + "_last_shedding_l2",
      state_topic: prefix + "/L2/state",
      value_template: "{% set ts = value_json.params.data.last_shedding %}{{ (ts / 1000) | timestamp_utc if ts else None }}",
      device_class: "timestamp", device: deviceInfo
    });
  } else if (step === 11) {
    pub("sensor/" + idPrefix + "/l2_shedding_count/config", {
      name: "L2 Shedding Count", object_id: idPrefix + "_l2_shedding_count", unique_id: idPrefix + "_shedding_count_l2",
      state_topic: prefix + "/L2/state", value_template: "{{ value_json.params.data.shedding_count }}",
      icon: "mdi:counter", state_class: "total_increasing", device: deviceInfo
    });
  } else if (step === 12) {
    pub("binary_sensor/" + idPrefix + "/l2_relay/config", {
      name: "L2 Relay", object_id: idPrefix + "_l2_relay", unique_id: idPrefix + "_relay_status_l2",
      state_topic: prefix + "/L2/state", value_template: "{{ value_json.params.data.relay_status }}",
      payload_on: "on", payload_off: "off", device_class: "power", device: deviceInfo,
      availability_topic: prefix + "/status", availability_template: "{{ 'online' if value_json.params.data.pro3_online else 'offline' }}"
    });
  }
  // L3 (steps 13-18)
  else if (step === 13) {
    pub("binary_sensor/" + idPrefix + "/l3_overload/config", {
      name: "L3 Overload", object_id: idPrefix + "_l3_overload", unique_id: idPrefix + "_overload_l3",
      state_topic: prefix + "/L3/state", value_template: "{{ value_json.params.data.overload }}",
      payload_on: "True", payload_off: "False", device_class: "problem", device: deviceInfo,
      availability_topic: onlineTopic, payload_available: "true", payload_not_available: "false"
    });
  } else if (step === 14) {
    pub("binary_sensor/" + idPrefix + "/l3_shedding/config", {
      name: "L3 Shedding", object_id: idPrefix + "_l3_shedding", unique_id: idPrefix + "_shedding_l3",
      state_topic: prefix + "/L3/state", value_template: "{{ value_json.params.data.shedding }}",
      payload_on: "True", payload_off: "False", device_class: "problem", device: deviceInfo,
      availability_topic: onlineTopic, payload_available: "true", payload_not_available: "false"
    });
  } else if (step === 15) {
    pub("sensor/" + idPrefix + "/l3_current/config", {
      name: "L3 Current", object_id: idPrefix + "_l3_current", unique_id: idPrefix + "_current_l3",
      state_topic: prefix + "/L3/state", value_template: "{{ value_json.params.data.current }}",
      unit_of_measurement: "A", device_class: "current", state_class: "measurement", expire_after: 30, device: deviceInfo
    });
  } else if (step === 16) {
    pub("sensor/" + idPrefix + "/l3_last_shedding/config", {
      name: "L3 Last Shedding", object_id: idPrefix + "_l3_last_shedding", unique_id: idPrefix + "_last_shedding_l3",
      state_topic: prefix + "/L3/state",
      value_template: "{% set ts = value_json.params.data.last_shedding %}{{ (ts / 1000) | timestamp_utc if ts else None }}",
      device_class: "timestamp", device: deviceInfo
    });
  } else if (step === 17) {
    pub("sensor/" + idPrefix + "/l3_shedding_count/config", {
      name: "L3 Shedding Count", object_id: idPrefix + "_l3_shedding_count", unique_id: idPrefix + "_shedding_count_l3",
      state_topic: prefix + "/L3/state", value_template: "{{ value_json.params.data.shedding_count }}",
      icon: "mdi:counter", state_class: "total_increasing", device: deviceInfo
    });
  } else if (step === 18) {
    pub("binary_sensor/" + idPrefix + "/l3_relay/config", {
      name: "L3 Relay", object_id: idPrefix + "_l3_relay", unique_id: idPrefix + "_relay_status_l3",
      state_topic: prefix + "/L3/state", value_template: "{{ value_json.params.data.relay_status }}",
      payload_on: "on", payload_off: "off", device_class: "power", device: deviceInfo,
      availability_topic: prefix + "/status", availability_template: "{{ 'online' if value_json.params.data.pro3_online else 'offline' }}"
    });
  }
  // Global entities (steps 19-24)
  else if (step === 19) {
    pub("binary_sensor/" + idPrefix + "/pro3_online/config", {
      name: "Pro3 Online", object_id: idPrefix + "_pro3_online", unique_id: idPrefix + "_pro3_online",
      state_topic: prefix + "/status", value_template: "{{ value_json.params.data.pro3_online | tojson }}",
      payload_on: "true", payload_off: "false", device_class: "connectivity", device: deviceInfo
    });
  } else if (step === 20) {
    pub("sensor/" + idPrefix + "/shedding_threshold/config", {
      name: "Shedding Threshold", object_id: idPrefix + "_shedding_threshold", unique_id: idPrefix + "_shedding_threshold",
      state_topic: prefix + "/status", value_template: "{{ value_json.params.data.shedding_threshold }}",
      unit_of_measurement: "A", device_class: "current", icon: "mdi:arrow-collapse-up", entity_category: "diagnostic", device: deviceInfo
    });
  } else if (step === 21) {
    pub("sensor/" + idPrefix + "/restoration_threshold/config", {
      name: "Restoration Threshold", object_id: idPrefix + "_restoration_threshold", unique_id: idPrefix + "_restoration_threshold",
      state_topic: prefix + "/status", value_template: "{{ value_json.params.data.restoration_threshold }}",
      unit_of_measurement: "A", device_class: "current", icon: "mdi:arrow-collapse-down", entity_category: "diagnostic", device: deviceInfo
    });
  } else if (step === 22) {
    pub("binary_sensor/" + idPrefix + "/pro3em_online/config", {
      name: "Pro3EM Online", object_id: idPrefix + "_pro3em_online", unique_id: idPrefix + "_pro3em_online",
      state_topic: onlineTopic, payload_on: "true", payload_off: "false", device_class: "connectivity", device: deviceInfo
    });
  } else if (step === 23) {
    pub("sensor/" + idPrefix + "/pro3em_version/config", {
      name: "Pro3EM Script version", object_id: idPrefix + "_pro3em_version", unique_id: idPrefix + "_pro3em_version",
      state_topic: prefix + "/status", value_template: "{{ value_json.params.data.pro3em_version }}",
      icon: "mdi:tag", entity_category: "diagnostic", device: deviceInfo
    });
  } else if (step === 24) {
    pub("sensor/" + idPrefix + "/pro3_version/config", {
      name: "Pro3 Script version", object_id: idPrefix + "_pro3_version", unique_id: idPrefix + "_pro3_version",
      state_topic: prefix + "/status", value_template: "{{ value_json.params.data.pro3_version }}",
      icon: "mdi:tag", entity_category: "diagnostic", device: deviceInfo
    });
  } else {
    print("\n=== DONE: " + ok + " OK, " + fail + " FAIL ===");
    return;
  }

  print("Step " + step + "/24");
  Timer.set(CONFIG.PUBLISH_DELAY, false, next);
}

print("\n=== HA DISCOVERY ===");
print("Prefix: " + prefix);

if (MQTT.isConnected()) {
  print("Starting in 2s...\n");
  Timer.set(2000, false, next);
} else {
  print("Waiting MQTT...");
  Timer.set(1000, false, function check() {
    if (MQTT.isConnected()) {
      print("Connected! Starting in 2s...\n");
      Timer.set(2000, false, next);
    } else {
      Timer.set(1000, false, check);
    }
  });
}
