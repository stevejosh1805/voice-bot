#!/usr/bin/env python3
"""
Test listener: pretends to be the robot.

Subscribes to <topic>/cmd on the same MQTT broker the web page uses, prints every
command, and replies on <topic>/status so you can see the round trip in the web page.
Run it on the laptop now; later the same loop moves onto the Raspberry Pi (or gets
ported to the ESP32) with real motor code where the TODOs are.

    pip install paho-mqtt
    python tools/robot_listener.py --topic voicebot/abc123

Use the topic shown in the web page under Settings > Robot link.
The browser connects over wss:// (port 8884); this script uses plain TCP (port 1883)
to the same broker, so both ends meet on the same topic.
"""
import argparse
import json
import time

import paho.mqtt.client as mqtt


def handle(cmd):
    action = cmd.get("action")
    if action == "move":
        print(f"  -> drive {cmd['dir']} {cmd['steps']} steps ({cmd.get('cm', '?')} cm)")
        # TODO: run motors for the right time / encoder counts
        time.sleep(0.2 * cmd["steps"])
    elif action == "rotate":
        print(f"  -> rotate {cmd['dir']} {cmd['deg']} degrees")
        # TODO: spin wheels in opposite directions until heading changes by deg
        time.sleep(cmd["deg"] / 180)
    elif action == "stop":
        print("  -> STOP")
        # TODO: cut motor power immediately
    else:
        print(f"  -> unknown action: {action}")
        return "unknown"
    return "done"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--broker", default="broker.hivemq.com")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--topic", required=True, help="e.g. voicebot/abc123 (without /cmd)")
    args = ap.parse_args()
    base = args.topic.rstrip("/")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"robot-listener-{int(time.time())}")

    def on_connect(c, _userdata, _flags, reason_code, _props):
        print(f"Connected to {args.broker} ({reason_code}). Listening on {base}/cmd")
        c.subscribe(f"{base}/cmd", qos=1)
        c.publish(f"{base}/status", "listener online")

    def on_message(c, _userdata, msg):
        try:
            cmd = json.loads(msg.payload.decode())
        except ValueError:
            print("Ignored non-JSON message:", msg.payload[:80])
            return
        print(f"#{cmd.get('id')} {cmd}")
        result = handle(cmd)
        c.publish(f"{base}/status", f"{result} #{cmd.get('id')} {cmd.get('action')}")

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(args.broker, args.port, keepalive=30)
    client.loop_forever()


if __name__ == "__main__":
    main()
