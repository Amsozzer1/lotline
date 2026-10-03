import mqtt from "mqtt";
import type { SourceMsg } from "../domain/messages";
import type { Ingestor } from "./ingest";

export const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
export const RUN_TOPIC = (toolId: string) => `tool/${toolId}/run`;

/**
 * The MQTT TelemetrySource: one ordered topic per tool, QoS 1. Messages are handled strictly one
 * at a time; the PUBACK goes out only after the handler finishes, so a failed message is
 * redelivered. A fixed client id with clean: false keeps the subscription across reconnects.
 */
export function startMqttSource(ing: Ingestor, log: (m: string) => void): { status: () => string; close: () => Promise<void> } {
  let status = "connecting";
  const client = mqtt.connect(MQTT_URL, { clientId: "lotline-ingest", clean: false, reconnectPeriod: 1000 });
  client.handleMessage = (packet, done) => {
    let msg: SourceMsg;
    try {
      msg = JSON.parse(packet.payload.toString()) as SourceMsg;
    } catch (e) {
      log(`dropping malformed message on ${packet.topic}: ${String(e)}`);
      done();
      return;
    }
    ing.handle(msg).then(
      () => done(),
      (e) => {
        log(`ingest failed on ${packet.topic}: ${String(e)}`);
        done(e as Error);
      },
    );
  };
  client.on("connect", () => {
    client.subscribe("tool/+/run", { qos: 1 }, (err) => {
      status = err ? `subscribe failed: ${err.message}` : "subscribed";
      log(`mqtt ${status} (${MQTT_URL})`);
    });
  });
  client.on("offline", () => (status = "offline"));
  client.on("error", (e) => log(`mqtt error: ${e.message}`));
  return { status: () => status, close: () => client.endAsync() };
}
