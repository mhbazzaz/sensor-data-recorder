const mqtt = require("mqtt");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");

const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://127.0.0.1:1883";
const MQTT_TOPIC = process.env.MQTT_TOPIC || "#";

const INFLUXDB_URL = process.env.INFLUXDB_URL || "http://localhost:8086";
const INFLUXDB_TOKEN = process.env.INFLUXDB_TOKEN || "SuperToken123456";
const INFLUXDB_ORG = process.env.INFLUXDB_ORG || "MohammadOrg";
const INFLUXDB_BUCKET = process.env.INFLUXDB_BUCKET || "FactoryMetrics";

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
const writeApi = influxDB.getWriteApi(INFLUXDB_ORG, INFLUXDB_BUCKET, "ms");
writeApi.useDefaultTags({ source: "sensor-app" });

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
    return "mqtt_message";
  }

  return sanitizeKey(topic.replace(/\//g, "_")) || "mqtt_message";
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

function extractJsonCandidate(payload) {
  const trimmed = payload.trim();
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");

  let startIndex = -1;
  if (objectStart >= 0 && arrayStart >= 0) {
    startIndex = Math.min(objectStart, arrayStart);
  } else if (objectStart >= 0) {
    startIndex = objectStart;
  } else if (arrayStart >= 0) {
    startIndex = arrayStart;
  }

  if (startIndex < 0) {
    return trimmed;
  }

  return trimmed.slice(startIndex);
}

function parseIncomingPayload(payload) {
  const trimmed = payload.trim();

  try {
    return JSON.parse(trimmed);
  } catch (firstError) {
    try {
      return JSON.parse(extractJsonCandidate(trimmed));
    } catch (secondError) {
      return parseScalarPayload(trimmed);
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
      if (Number.isInteger(value) && key.endsWith("_count")) {
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
  const payloadText = message.toString();
  console.log(`[mqtt] topic=${topic} bytes=${message.length}`);

  let parsedPayload;
  try {
    parsedPayload = parseIncomingPayload(payloadText);
  } catch (error) {
    console.error(`[parse] Failed to parse payload from ${topic}:`, error);
    return;
  }

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

  Object.entries(extractTags(fields, topic)).forEach(([key, value]) => {
    point.tag(key, value);
  });

  point.timestamp(timestamp);

  let fieldAdded = addFieldsToPoint(point, fields);
  if (!fieldAdded) {
    point.stringField("raw_payload", payloadText.slice(0, 65000));
    point.stringField(
      "payload_type",
      Array.isArray(parsedPayload) ? "array" : typeof parsedPayload,
    );
    fieldAdded = true;
  }

  if (!fieldAdded) {
    console.warn(`[write] No writable fields for topic ${topic}`);
    return;
  }

  try {
    writeApi.writePoint(point);
    await writeApi.flush();
  } catch (error) {
    console.error(`[write] FAILED measurement=${measurement}:`, error);
  }
}

console.log("Starting Sensor Data Recorder");
console.log(`MQTT Broker : ${MQTT_BROKER}`);
console.log(`MQTT Topic  : ${MQTT_TOPIC}`);
console.log(`InfluxDB    : ${INFLUXDB_URL}`);
console.log(`Org/Bucket  : ${INFLUXDB_ORG} / ${INFLUXDB_BUCKET}`);

const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: `sensor-data-recorder-${Math.random().toString(16).slice(2, 10)}`,
  clean: true,
  reconnectPeriod: 1000,
  connectTimeout: 30000,
  keepalive: 60,
  family: 4,
  protocolVersion: 4,
});

mqttClient.on("connect", () => {
  console.log("[mqtt] Connected");
  mqttClient.subscribe(MQTT_TOPIC, { qos: 1 }, (error) => {
    if (error) {
      console.error("[mqtt] Subscribe failed:", error);
      return;
    }

    console.log(`[mqtt] Subscribed to ${MQTT_TOPIC}`);
    console.log("[mqtt] Waiting for messages...");
  });
});

mqttClient.on("reconnect", () => {
  console.log("[mqtt] Reconnecting...");
});

mqttClient.on("offline", () => {
  console.log("[mqtt] Offline");
});

mqttClient.on("error", (error) => {
  console.error("[mqtt] Error:", error);
});

mqttClient.on("message", (topic, message) => {
  processMessage(topic, message).catch((error) => {
    console.error(`[mqtt] Unhandled processing error for ${topic}:`, error);
  });
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  mqttClient.end(true);

  try {
    await writeApi.close();
    console.log("InfluxDB write API closed.");
    process.exit(0);
  } catch (error) {
    console.error("Error closing InfluxDB write API:", error);
    process.exit(1);
  }
});

// from(bucket: "FactoryMetrics")
//   |> range(start: -1h)
//   |> filter(fn: (r) => r["_measurement"] == "sensor")
