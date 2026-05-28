const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const mqtt = require("mqtt");

// Copy your existing functions here
function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function sanitizeKey(value) {
  return (
    String(value)
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "value"
  );
}

function topicToMeasurement(topic) {
  if (!topic || typeof topic !== "string") {
    return "default_measurement";
  }
  const sanitized = sanitizeKey(topic.replace(/\//g, "_"));
  if (sanitized === "value") {
    const manualSanitize = topic
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return manualSanitize || "sensor";
  }
  return sanitized;
}

function parseIncomingPayload(payload) {
  try {
    return JSON.parse(payload);
  } catch (error) {
    try {
      let cleanedPayload = payload.trim();
      if (/^[a-zA-Z0-9_]+\s*\{/.test(cleanedPayload)) {
        cleanedPayload = cleanedPayload.replace(/^[a-zA-Z0-9_]+\s*/, "");
      }
      return JSON.parse(cleanedPayload);
    } catch (e) {
      console.log("⚠️ Failed to parse JSON:", e.message);
      return null;
    }
  }
}

function buildNormalizedPayload(input) {
  if (isPlainObject(input)) {
    return input;
  }
  if (Array.isArray(input)) {
    return { value: input };
  }
  return { value: input };
}

function collectValues(value, currentPath, fields, notes) {
  const safePath = sanitizeKey(currentPath || "value");
  if (value === null || value === undefined) {
    notes.push(`${safePath}:null`);
    return;
  }
  if (Array.isArray(value)) {
    addField(fields, `${safePath}_count`, value.length);
    value.forEach((item, index) => {
      collectValues(item, `${safePath}_${index}`, fields, notes);
    });
    return;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      notes.push(`${safePath}:empty_object`);
      return;
    }
    for (const [key, childValue] of entries) {
      const nextPath = currentPath ? `${currentPath}_${key}` : key;
      collectValues(childValue, nextPath, fields, notes);
    }
    return;
  }
  addField(fields, safePath, value);
}

function addField(fields, key, value) {
  if (!key) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    fields[key] = value;
  } else if (typeof value === "string" || typeof value === "boolean") {
    fields[key] = value;
  }
}

function extractTags(fields, topic) {
  const tags = { original_topic: topic };
  const topicLevels = topic.split("/").filter(Boolean);
  topicLevels.forEach((segment, index) => {
    tags[`topic_level_${index}`] = segment;
  });
  for (const [key, value] of Object.entries(fields)) {
    const tagKeys = new Set([
      "device",
      "device_id",
      "deviceid",
      "sensor",
      "sensor_id",
      "sensorid",
      "sensor_type",
      "sensortype",
      "site",
      "location",
      "room",
      "zone",
      "line",
      "machine",
      "unit",
      "model",
      "firmware",
    ]);
    if (tagKeys.has(key)) {
      tags[key] = String(value);
    }
  }
  return tags;
}

function extractTimestamp(payload, fields) {
  if (!isPlainObject(payload)) return new Date();
  const timestampKeys = new Set([
    "timestamp",
    "time",
    "ts",
    "datetime",
    "date",
    "recorded_at",
    "created_at",
    "observed_at",
  ]);
  for (const [key, value] of Object.entries(payload)) {
    if (!timestampKeys.has(sanitizeKey(key))) continue;
    let detected = null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      detected = value;
    } else if (typeof value === "number") {
      let ms = value;
      if (value > 1e17) ms = Math.floor(value / 1e6);
      else if (value > 1e14) ms = Math.floor(value / 1e3);
      else if (value < 1e11) ms = value * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) detected = d;
    } else if (typeof value === "string") {
      const n = Number(value);
      if (!Number.isNaN(n)) {
        let ms = n;
        if (n > 1e17) ms = Math.floor(n / 1e6);
        else if (n > 1e14) ms = Math.floor(n / 1e3);
        else if (n < 1e11) ms = n * 1000;
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) detected = d;
      } else {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) detected = d;
      }
    }
    if (detected) {
      delete fields[sanitizeKey(key)];
      return detected;
    }
  }
  return new Date();
}

function addFieldsToPoint(point, fields) {
  let added = false;
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "number") {
      if (key.endsWith("_count")) {
        point.intField(key, value);
      } else {
        point.floatField(key, value);
      }
      added = true;
    } else if (typeof value === "string") {
      point.stringField(key, value);
      added = true;
    } else if (typeof value === "boolean") {
      point.booleanField(key, value);
      added = true;
    }
  }
  return added;
}

// Test data exactly from your message
const testPayload = ` Sensor { 
         "Ave_Power" : 
         [ 
                 9559 
         ], 
         "Cos Phi" : 
         [ 
                 0.90091997385025024, 
                 0.90781998634338379 
         ], 
         "Current_1" : 
         [ 
                 1336.0001220703125, 
                 1290.4000244140625 
         ], 
         "Current_2" : 
         [ 
                 1290.4000244140625, 
                 1342.4000244140625 
         ], 
         "Current_3" : 
         [ 
                 1342.4000244140625, 
                 1323.2000732421875 
         ], 
         "Frequency" : 
         [ 
                 49.999099731445312, 
                 784.2081298828125 
         ], 
         "Power_1" : 
         [ 
                 265.07040405273438, 
                 254.21363830566406 
         ], 
         "Power_2" : 
         [ 
                 254.21363830566406, 
                 264.92404174804688 
         ], 
         "Power_3" : 
         [ 
                 264.92404174804688, 
                 377.748046875 
         ], 
         "Power_Total" : 
         [ 
                 784.2081298828125, 
                 265.07040405273438 
         ], 
         "Voltage_L1" : 
         [ 
                 218.55000305175781, 
                 219.32400512695312 
         ], 
         "Voltage_L1-L2" : 
         [ 
                 378.14801025390625, 
                 379.56600952148438 
         ], 
         "Voltage_L2" : 
         [ 
                 219.32400512695312, 
                 220.13200378417969 
         ], 
         "Voltage_L2-L3" : 
         [ 
                 379.56600952148438, 
                 380.9110107421875 
         ], 
         "Voltage_L3" : 
         [ 
                 220.13200378417969, 
                 219.33601379394531 
         ], 
         "Voltage_L3-L1" : 
         [ 
                 380.9110107421875, 
                 379.53701782226562 
         ] 
 }`.trim();

// Test parsing
console.log("=== Testing ===");
const parsed = parseIncomingPayload(testPayload);
const normalized = buildNormalizedPayload(parsed);
const fields = {};
const notes = [];
collectValues(normalized, "", fields, notes);

console.log("✅ Parsed successfully, fields:", fields);
console.log("✅ Measurement name:", topicToMeasurement("Sensor"));
console.log("✅ Done!");
