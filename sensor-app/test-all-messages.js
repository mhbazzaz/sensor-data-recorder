const mqtt = require("mqtt");

console.log("🔍 Connecting to Mosquitto to spy on ALL topics");
console.log("");

const client = mqtt.connect("mqtt://localhost:1883", {
  clientId: "spy-client",
  clean: true,
});

client.on("connect", () => {
  console.log("✅ Connected to Mosquitto");
  console.log("📡 Subscribing to EVERYTHING (#)");
  console.log("");
  console.log("👂 Now listening for messages...");
  console.log("");
  client.subscribe("#", (err) => {
    if (err) {
      console.error("❌ Subscription failed:", err);
    }
  });
});

client.on("message", (topic, message) => {
  const ts = new Date().toISOString();
  console.log(`========================================`);
  console.log(`📩 New Message at ${ts}`);
  console.log(`   Topic: [${topic}]`);
  console.log(`   Length: ${message.length} bytes`);
  console.log("");
  console.log("   Payload preview:");
  const lines = message.toString().split("\n").slice(0, 10);
  lines.forEach((line) => console.log(`   ${line}`));
  if (message.toString().split("\n").length > 10) {
    console.log(
      `   ...and ${message.toString().split("\n").length - 10} more lines`,
    );
  }
  console.log("========================================\n");
});

client.on("error", (err) => {
  console.error("❌ Error:", err);
});

console.log("");
