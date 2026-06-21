/**
 * ESP32 WiFi + MQTT 示例。
 *
 * 端到端验证网络路径：ESP32 加入仿真器的虚拟 AP（SSID "Velxio-GUEST"），
 * 通过 QEMU slirp NAT 访问互联网，并通过公共 MQTT 代理（broker.hivemq.com）
 * 完成消息往返。
 *
 * 自包含：代码发布到唯一主题并订阅同一主题，每条消息经代理返回后翻转
 * GPIO2。无需外部客户端或本地代理——打开 115200 波特串口监视器即可观察
 * TX/RX。已在 QEMU 中验证：WiFi 连接、DNS 解析、TCP 到 :1883 均成功。
 */
import type { ExampleProject } from './examples';

const ESP32_MQTT_CODE = `// ESP32 + WiFi + MQTT (PubSubClient)
// 加入仿真器 AP "Velxio-GUEST"，连接公共 MQTT 代理，
// 发布到自身主题并订阅之，每条消息经代理往返后翻转 GPIO2。
// 以 115200 波特打开串口监视器。将 LED 接至 GPIO2 可观察每次往返闪烁。
#include <WiFi.h>
#include <PubSubClient.h>

const char* WIFI_SSID   = "Velxio-GUEST";   // 仿真器广播的开放 AP
const char* MQTT_BROKER = "broker.hivemq.com";
const int   MQTT_PORT   = 1883;
const int   LED         = 2;

WiFiClient net;
PubSubClient mqtt(net);
String topic;  // 每块板唯一，避免两块 ESP32 冲突

void onMessage(char* t, byte* payload, unsigned int len) {
  String m;
  for (unsigned int i = 0; i < len; i++) m += (char)payload[i];
  Serial.printf("RX [%s]: %s\\n", t, m.c_str());
  digitalWrite(LED, !digitalRead(LED));  // 每次往返翻转
}

void connectWiFi() {
  Serial.printf("WiFi: 正在加入 %s ...\\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.printf("\\nWiFi 已连接, IP %s\\n", WiFi.localIP().toString().c_str());
}

void connectMQTT() {
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMessage);
  while (!mqtt.connected()) {
    String cid = "velxio-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    Serial.printf("MQTT: 正在连接 %s 作为 %s ...\\n", MQTT_BROKER, cid.c_str());
    if (mqtt.connect(cid.c_str())) {
      Serial.println("MQTT 已连接");
      mqtt.subscribe(topic.c_str());
      Serial.printf("已订阅 %s\\n", topic.c_str());
    } else {
      Serial.printf("MQTT 失败, rc=%d, 2秒后重试\\n", mqtt.state());
      delay(2000);
    }
  }
}

unsigned long lastPub = 0;
int counter = 0;

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  delay(500);
  topic = "velxio/demo/" + String((uint32_t)ESP.getEfuseMac(), HEX);
  connectWiFi();
  connectMQTT();
}

void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();
  if (millis() - lastPub > 2000) {
    lastPub = millis();
    String msg = "hello " + String(counter++);
    mqtt.publish(topic.c_str(), msg.c_str());
    Serial.printf("TX [%s]: %s\\n", topic.c_str(), msg.c_str());
  }
}
`;

export const esp32MqttExamples: ExampleProject[] = [
  {
    id: 'esp32-wifi-mqtt',
    title: 'ESP32 WiFi + MQTT 通信',
    description:
      'ESP32 连接 WiFi 和公共 MQTT 代理。代码发布到自身主题并订阅之，' +
      '每条消息经 broker.hivemq.com 往返后翻转 GPIO2——无需外部配置即可' +
      '自包含验证 WiFi 与 MQTT。以 115200 波特打开串口监视器观察连接及消息' +
      '交换过程。仿真器广播名为 "Velxio-GUEST" 的开放 AP。',
    category: 'communication',
    difficulty: 'intermediate',
    boardType: 'esp32',
    boardFilter: 'esp32',
    tags: ['esp32', 'wifi', 'mqtt', 'pubsubclient', '物联网', '网络'],
    libraries: ['PubSubClient'],
    code: ESP32_MQTT_CODE,
    components: [],
    wires: [],
  },
];
