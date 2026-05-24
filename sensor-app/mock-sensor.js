const mqtt = require("mqtt");

const MQTT_BROKER = "mqtt://localhost:1883";
const SENSORS = ["machine1", "machine2"];

function randomFloat(min, max) {
  const value = parseFloat((Math.random() * (max - min) + min).toFixed(2));
  return Number.isInteger(value) ? value + 0.01 : value;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildTelemetryPayload(sensor) {
  return {
    device_id: sensor,
    sensor_type: "environment",
    site: "factory-a",
    timestamp: new Date().toISOString(),
    metrics: {
      temperature: randomFloat(20, 80),
      humidity: randomFloat(30, 90),
      pressure: randomFloat(1, 5),
    },
    status: {
      running: Math.random() > 0.15,
      battery_level: randomInt(55, 100),
    },
    readings: [
      randomFloat(0.1, 9.9),
      randomFloat(0.1, 9.9),
      randomFloat(0.1, 9.9),
    ],
  };
}

function buildVibrationPayload(sensor) {
  return {
    device_id: sensor,
    sensor_type: "vibration",
    timestamp: Date.now(),
    axis: {
      x: randomFloat(-2, 2),
      y: randomFloat(-2, 2),
      z: randomFloat(-2, 2),
    },
    peaks: [
      { hz: randomFloat(20, 80), amplitude: randomFloat(0.1, 4.5) },
      { hz: randomFloat(81, 160), amplitude: randomFloat(0.1, 4.5) },
    ],
  };
}

console.log("Connecting to MQTT Broker for mock sensors...");
const client = mqtt.connect(MQTT_BROKER);

client.on("connect", () => {
  console.log("Started mock sensors. Press Ctrl+C to stop.");

  setInterval(() => {
    SENSORS.forEach((sensor) => {
      const telemetryTopic = `sensors/${sensor}/data`;
      const telemetryPayload = buildTelemetryPayload(sensor);
      client.publish(telemetryTopic, JSON.stringify(telemetryPayload));
      console.log(`Published to ${telemetryTopic}:`, telemetryPayload);

      const vibrationTopic = `sensors/${sensor}/vibration`;
      const vibrationPayload = buildVibrationPayload(sensor);
      client.publish(vibrationTopic, JSON.stringify(vibrationPayload));
      console.log(`Published to ${vibrationTopic}:`, vibrationPayload);

      const rawTopic = `sensors/${sensor}/raw_value`;
      const rawPayload = String(randomFloat(10, 99));
      client.publish(rawTopic, rawPayload);
      console.log(`Published to ${rawTopic}:`, rawPayload);
    });
  }, 2000);
});

process.on("SIGINT", () => {
  console.log("\nStopped mock sensors.");
  client.end();
  process.exit(0);
});
