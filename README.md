# Sensor Data Recorder

This project receives MQTT sensor data, normalizes mixed payload formats, and writes them into InfluxDB.

It includes:
- `mosquitto` as the MQTT broker
- `influxdb` for time-series storage
- `nodered` for optional flow-based integration
- `sensor-app/index.js` as the MQTT to InfluxDB receiver
- `sensor-app/mock-sensor.js` as a sample sensor publisher

## Architecture

1. Sensors publish to MQTT topics on Mosquitto.
2. The Node.js receiver subscribes to all topics using `#`.
3. Incoming payloads are normalized into tags, fields, and timestamps.
4. The receiver writes the data into the `FactoryMetrics` bucket in InfluxDB.

## Services

### MQTT Broker
- URL: `mqtt://localhost:1883`
- WebSocket port: `9001`

### InfluxDB
- URL: `http://localhost:8086`
- Username: `admin`
- Password: `admin123`
- Organization: `MohammadOrg`
- Bucket: `FactoryMetrics`
- Admin token: `SuperToken123456`

### Node-RED
- URL: `http://localhost:1880`

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ recommended
- npm

## Start The Stack

From the project root:

```bash
docker compose up -d
```

To stop the stack:

```bash
docker compose down
```

To reset InfluxDB demo data completely:

```bash
docker compose down -v
docker compose up -d
```

## Install The Node App

From `sensor-app`:

```bash
npm install
```

## Run The Receiver

From `sensor-app`:

```bash
node index.js
```

Expected startup logs:

```text
Connecting to MQTT Broker...
Connected to MQTT broker successfully
Subscribed to wildcard topic: #
```

## Run The Mock Sensors

From `sensor-app` in a second terminal:

```bash
node mock-sensor.js
```

This publisher sends three kinds of example data:
- environment telemetry on `sensors/<machine>/data`
- vibration telemetry on `sensors/<machine>/vibration`
- raw scalar values on `sensors/<machine>/raw_value`

## Supported Payload Types

The receiver is designed to support most practical MQTT sensor payloads.

### 1. Raw scalar values

Examples:

```text
42.7
```

```text
true
```

```text
online
```

These are normalized into a single field named `value`.

### 2. Flat JSON objects

Example:

```json
{
  "temperature": 25.4,
  "humidity": 64.2,
  "running": true
}
```

### 3. Nested JSON objects

Example:

```json
{
  "device_id": "machine1",
  "metrics": {
    "temperature": 54.98,
    "humidity": 71.35
  },
  "status": {
    "running": true
  }
}
```

This becomes fields like:
- `metrics_temperature`
- `metrics_humidity`
- `status_running`

### 4. Arrays

Example:

```json
{
  "readings": [0.45, 6.57, 6.19]
}
```

Arrays are stored in multiple ways:
- `readings_count`
- `readings_json`
- `readings_0`
- `readings_1`
- `readings_2`

### 5. Arrays Of Objects

Example:

```json
{
  "peaks": [
    { "hz": 70.86, "amplitude": 2.08 },
    { "hz": 87.91, "amplitude": 2.86 }
  ]
}
```

This becomes fields like:
- `peaks_count`
- `peaks_json`
- `peaks_0_hz`
- `peaks_0_amplitude`
- `peaks_1_hz`
- `peaks_1_amplitude`

## Automatic Tag Extraction

If a payload contains metadata keys such as these, they are also written as InfluxDB tags:
- `device`
- `device_id`
- `sensor`
- `sensor_id`
- `sensor_type`
- `site`
- `location`
- `room`
- `zone`
- `machine`
- `model`
- `firmware`

The receiver also stores:
- `original_topic`
- `topic_level_0`
- `topic_level_1`
- `topic_level_2`

For example, the topic `sensors/machine2/vibration` becomes:
- `original_topic = sensors/machine2/vibration`
- `topic_level_0 = sensors`
- `topic_level_1 = machine2`
- `topic_level_2 = vibration`

## Timestamp Handling

The receiver looks for sensor-side timestamps using keys such as:
- `timestamp`
- `time`
- `ts`
- `datetime`
- `recorded_at`
- `created_at`
- `observed_at`

Supported timestamp formats:
- ISO strings like `2026-05-24T13:56:21.154Z`
- millisecond epoch numbers
- microsecond and nanosecond epoch numbers
- second epoch numbers

If no supported timestamp is present, the receiver uses the current server time.

## Measurement Naming

Each MQTT topic becomes an InfluxDB measurement by replacing non-alphanumeric separators with underscores.

Examples:
- `sensors/machine1/data` -> `sensors_machine1_data`
- `sensors/machine2/vibration` -> `sensors_machine2_vibration`
- `sensors/machine1/raw_value` -> `sensors_machine1_raw_value`

## Field Type Rules

To avoid InfluxDB field type conflicts:
- fields ending with `_count` are stored as integers
- all other numeric sensor values are stored as floats
- strings are stored as string fields
- booleans are stored as boolean fields

## Example Supported Payloads

### Environment Sensor

```json
{
  "device_id": "machine1",
  "sensor_type": "environment",
  "site": "factory-a",
  "timestamp": "2026-05-24T13:56:21.154Z",
  "metrics": {
    "temperature": 54.98,
    "humidity": 71.35,
    "pressure": 2.28
  },
  "status": {
    "running": true,
    "battery_level": 63
  },
  "readings": [0.45, 6.57, 6.19]
}
```

### Vibration Sensor

```json
{
  "device_id": "machine2",
  "sensor_type": "vibration",
  "timestamp": 1779630981154,
  "axis": {
    "x": 0.06,
    "y": -0.78,
    "z": -1.6
  },
  "peaks": [
    { "hz": 70.86, "amplitude": 2.08 },
    { "hz": 87.91, "amplitude": 2.86 }
  ]
}
```

### Raw Topic

```text
59.93
```

## View Data In InfluxDB

Open:

```text
http://localhost:8086
```

Then:
1. Log in with `admin` / `admin123`
2. Open `Data Explorer`
3. Select bucket `FactoryMetrics`
4. Run a Flux query

### Example: Show Latest Machine 2 Temperature

```flux
from(bucket: "FactoryMetrics")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement == "sensors_machine2_data")
  |> filter(fn: (r) => r._field == "metrics_temperature")
  |> sort(columns: ["_time"], desc: true)
```

### Example: Show Machine 2 Vibration Peaks

```flux
from(bucket: "FactoryMetrics")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement == "sensors_machine2_vibration")
  |> filter(fn: (r) => r._field =~ /peaks_.*/)
  |> sort(columns: ["_time"], desc: true)
```

### Example: Pivot Environment Fields Into Rows

```flux
from(bucket: "FactoryMetrics")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement == "sensors_machine1_data")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"], desc: true)
```

## Project Files

- `docker-compose.yml`: starts Mosquitto, InfluxDB, and Node-RED
- `mosquitto/config/mosquitto.conf`: Mosquitto listener configuration
- `sensor-app/index.js`: MQTT receiver and InfluxDB writer
- `sensor-app/mock-sensor.js`: sample publisher for test data

## Notes

- The receiver subscribes to all MQTT topics using `#`, so be careful if you connect noisy publishers.
- If InfluxDB starts rejecting writes with field type conflicts, reset the demo data with `docker compose down -v`.
- Arrays are preserved both as flattened fields and as JSON strings for easier debugging.
