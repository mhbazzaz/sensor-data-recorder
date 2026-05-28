const mqtt = require("mqtt");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");

const MQTT_BROKER = "mqtt://localhost:1883";
const MQTT_TOPIC = "#";

const INFLUXDB_URL = "http://localhost:8086";
const INFLUXDB_TOKEN = "SuperToken123456";
const INFLUXDB_ORG = "MohammadOrg";
const INFLUXDB_BUCKET = "FactoryMetrics";

const TAG_CANDIDATE_KEYS = new Set([
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

const TIMESTAMP_KEYS = new Set([
  "timestamp",
  "time",
  "ts",
  "datetime",
  "date",
  "recorded_at",
  "created_at",
  "observed_at",
]);

const influxDB = new InfluxDB({ url: INFLUXDB_URL, token: INFLUXDB_TOKEN });
const writeApi = influxDB.getWriteApi(INFLUXDB_ORG, INFLUXDB_BUCKET);

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
  // If the topic is empty or invalid, fallback to "default_measurement"
  if (!topic || typeof topic !== "string") {
    return "default_measurement";
  }

  const sanitized = sanitizeKey(topic.replace(/\//g, "_"));

  // If sanitizeKey returns "value" (which it does as a fallback),
  // return the actual topic name sanitized manually, or a specific fallback.
  if (sanitized === "value") {
    const manualSanitize = topic
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    return manualSanitize || "sensor";
  }

  return sanitized;
}

function parseScalarPayload(payload) {
  const trimmed = payload.trim();
  const lowered = trimmed.toLowerCase();

  if (lowered === "true") {
    return true;
  }

  if (lowered === "false") {
    return false;
  }

  if (lowered === "null") {
    return null;
  }

  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }

  return payload;
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
      console.log(`⚠️ Failed to parse JSON: ${e.message}`);
      console.log(`   Raw payload preview: ${payload.substring(0, 200)}...`);
      return null;
    }
  }
}

function detectTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    let milliseconds = value;

    if (value > 1e17) {
      milliseconds = Math.floor(value / 1e6);
    } else if (value > 1e14) {
      milliseconds = Math.floor(value / 1e3);
    } else if (value < 1e11) {
      milliseconds = value * 1000;
    }

    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return detectTimestamp(asNumber);
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
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

function addField(fields, key, value) {
  if (!key) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return;
    }

    fields[key] = value;
    return;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    fields[key] = value;
  }
}

function collectValues(value, currentPath, fields, notes) {
  const safePath = sanitizeKey(currentPath || "value");

  if (value === null || value === undefined) {
    notes.push(`${safePath}:null`);
    return;
  }

  if (Array.isArray(value)) {
    addField(fields, `${safePath}_count`, value.length);
    addField(fields, `${safePath}_json`, JSON.stringify(value));

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

function extractTags(fields, topic) {
  const tags = {
    original_topic: topic,
  };

  const topicLevels = topic.split("/").filter(Boolean);
  topicLevels.forEach((segment, index) => {
    tags[`topic_level_${index}`] = segment;
  });

  for (const [key, value] of Object.entries(fields)) {
    if (!TAG_CANDIDATE_KEYS.has(key)) {
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      typeof value === "number"
    ) {
      tags[key] = String(value);
    }
  }

  return tags;
}

function extractTimestamp(payload, fields) {
  if (!isPlainObject(payload)) {
    return new Date();
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!TIMESTAMP_KEYS.has(sanitizeKey(key))) {
      continue;
    }

    const timestamp = detectTimestamp(value);
    if (timestamp) {
      delete fields[sanitizeKey(key)];
      return timestamp;
    }
  }

  return new Date();
}

function addFieldsToPoint(point, fields) {
  let fieldAdded = false;

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "number") {
      if (key.endsWith("_count")) {
        point.intField(key, value);
      } else {
        point.floatField(key, value);
      }
      fieldAdded = true;
    } else if (typeof value === "string") {
      point.stringField(key, value);
      fieldAdded = true;
    } else if (typeof value === "boolean") {
      point.booleanField(key, value);
      fieldAdded = true;
    }
  }

  return fieldAdded;
}

async function processMessage(topic, message) {
  console.log("\n===============================");
  console.log(`📥 New message received on topic: ${topic}`);

  const payloadText = message.toString();
  const parsedPayload = parseIncomingPayload(payloadText);

  if (!parsedPayload) {
    console.log("❌ Skipping invalid payload");
    return;
  }

  console.log("✅ Payload parsed successfully");
  const normalizedPayload = buildNormalizedPayload(parsedPayload);
  const fields = {};
  const notes = [];

  collectValues(normalizedPayload, "", fields, notes);

  if (notes.length > 0) {
    fields.ingest_notes = notes.join("|");
  }

  const timestamp = extractTimestamp(normalizedPayload, fields);
  const measurement = topicToMeasurement(topic);
  const point = new Point(measurement);

  const tags = extractTags(fields, topic);
  Object.entries(tags).forEach(([key, value]) => {
    point.tag(key, value);
  });

  point.timestamp(timestamp);

  const fieldAdded = addFieldsToPoint(point, fields);

  console.log(
    `📋 Fields extracted:`,
    Object.keys(fields).slice(0, 10),
    Object.keys(fields).length > 10
      ? `...and ${Object.keys(fields).length - 10} more`
      : "",
  );

  if (!fieldAdded) {
    console.log("⚠️ No fields found, saving raw payload");
    point.stringField("raw_payload", payloadText);
    point.stringField(
      "payload_type",
      Array.isArray(parsedPayload) ? "array" : typeof parsedPayload,
    );
  }

  console.log(`💾 Writing to InfluxDB measurement: ${measurement}`);
  writeApi.writePoint(point);

  try {
    await writeApi.flush();
    console.log("✅ Save to InfluxDB SUCCESS!");
  } catch (err) {
    console.log("❌ Save to InfluxDB FAILED:", err);
  }
  console.log("===============================\n");
}

console.log("🚀 Starting Sensor Data Recorder...");
console.log("");
console.log("Configuration:");
console.log(`   - MQTT Broker: ${MQTT_BROKER}`);
console.log(`   - MQTT Topic: ${MQTT_TOPIC}`);
console.log(`   - InfluxDB: ${INFLUXDB_URL}`);
console.log(`   - InfluxDB Org: ${INFLUXDB_ORG}`);
console.log(`   - InfluxDB Bucket: ${INFLUXDB_BUCKET}`);
console.log("");

const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: "sensor-data-recorder",
  clean: true,
  reconnectPeriod: 1000,
  connectTimeout: 30 * 1000,
  keepalive: 60,
});

mqttClient.on("connect", () => {
  console.log("✅ Connected to MQTT broker successfully!");
  console.log(`📡 Subscribing to topic: ${MQTT_TOPIC}`);
  mqttClient.subscribe(MQTT_TOPIC, (err) => {
    if (!err) {
      console.log("✅ Subscription successful!");
      console.log("");
      console.log("👂 Waiting for ANY MQTT message...");
    } else {
      console.error(`❌ Error subscribing: ${err}`);
    }
  });
});

mqttClient.on("reconnect", () => {
  console.log("🔄 Reconnecting to MQTT broker...");
});

mqttClient.on("offline", () => {
  console.log("⚠️ MQTT client went offline!");
});

mqttClient.on("error", (error) => {
  console.error("❌ MQTT ERROR:", error);
});

mqttClient.on("message", (topic, message) => {
  console.log(`\n📥 RAW message received on topic: ${topic}`);
  console.log(`   Message length: ${message.length} bytes`);
  console.log(`   Message preview: ${message.toString().substring(0, 150)}...`);
  console.log("");
  processMessage(topic, message).catch((error) => {
    console.error("❌ Error processing message:", error);
  });
});

process.on("SIGINT", async () => {
  console.log("\nDisconnecting...");
  mqttClient.end();

  try {
    await writeApi.close();
    console.log("InfluxDB write API closed.");
    process.exit(0);
  } catch (error) {
    console.error("Error closing InfluxDB write API", error);
    process.exit(1);
  }
});
