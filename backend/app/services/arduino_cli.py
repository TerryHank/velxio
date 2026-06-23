import subprocess
import tempfile
import asyncio
import base64
import hashlib
import json
import shutil
import re
import os
from pathlib import Path

from app.core.hooks import materialize_library_scope


# A preprocessor "fatal error: Foo.h: No such file or directory" — the signature
# of a missing #include. Used to decide whether a FAILED manifest-scoped compile
# should retry scan-all (the manifest omitted a needed / transitive library) vs
# surface the failure as-is (a genuine source error).
_MISSING_HEADER_RE = re.compile(
    r"fatal error:\s*\S+\.h(?:pp)?:\s*No such file or directory", re.IGNORECASE
)

CLI_FAST_TIMEOUT_SECONDS = int(os.environ.get("VELXIO_ARDUINO_CLI_FAST_TIMEOUT_SECONDS", "30"))
CLI_CORE_INSTALL_TIMEOUT_SECONDS = int(os.environ.get("VELXIO_ARDUINO_CLI_CORE_INSTALL_TIMEOUT_SECONDS", "300"))
CLI_COMPILE_TIMEOUT_SECONDS = int(os.environ.get("VELXIO_ARDUINO_CLI_COMPILE_TIMEOUT_SECONDS", "180"))

STM32_RENODE_CLOCK_HOOK = """// Velxio STM32/Renode shim: Renode's F103 model
// does not currently emulate the full STM32duino clock bring-up path used by
// the default variant. Keep the sketch on the reset clock so Arduino APIs can
// reach setup()/loop() under simulation.
extern "C" void SystemClock_Config(void) {}

"""

STM32_RENODE_SERIAL_SHIM = """// Velxio STM32/Renode shim: route sketch Serial/Serial1 to a
// polling USART2 writer. This avoids depending on STM32duino's interrupt
// driven HardwareSerial path, which is not fully reliable under Renode F103.
#if defined(ARDUINO_ARCH_STM32)
#undef Serial
#undef Serial1

#define VELXIO_REG32(addr) (*(volatile uint32_t *)(addr))
#define VELXIO_RCC_APB2ENR VELXIO_REG32(0x40021018UL)
#define VELXIO_RCC_APB1ENR VELXIO_REG32(0x4002101CUL)
#define VELXIO_GPIOA_CRL   VELXIO_REG32(0x40010800UL)
#define VELXIO_USART2_SR   VELXIO_REG32(0x40004400UL)
#define VELXIO_USART2_DR   VELXIO_REG32(0x40004404UL)
#define VELXIO_USART2_BRR  VELXIO_REG32(0x40004408UL)
#define VELXIO_USART2_CR1  VELXIO_REG32(0x4000440CUL)

class VelxioRenodeUsart2Serial : public Print {
public:
  void begin(unsigned long baud) { configure(baud); }
  void begin(unsigned long baud, uint8_t) { configure(baud); }
  void end() {}
  operator bool() const { return true; }
  int available() { return (VELXIO_USART2_SR & (1UL << 5)) ? 1 : 0; }
  int peek() { return -1; }
  int read() {
    if (!available()) return -1;
    return (int)(VELXIO_USART2_DR & 0xffU);
  }
  int availableForWrite() { return 1; }
  void flush() {
    uint32_t guard = 1000000UL;
    while (!(VELXIO_USART2_SR & (1UL << 6)) && --guard) {}
  }
  size_t write(uint8_t ch) override {
    if (!configured) configure(baudRate);
    uint32_t guard = 1000000UL;
    while (!(VELXIO_USART2_SR & (1UL << 7)) && --guard) {}
    VELXIO_USART2_DR = ch;
    return 1;
  }
  using Print::write;

private:
  bool configured = false;
  unsigned long baudRate = 115200;

  void configure(unsigned long baud) {
    if (baud == 0) baud = 115200;
    baudRate = baud;

    // AFIO + GPIOA clocks on APB2, USART2 clock on APB1.
    VELXIO_RCC_APB2ENR |= (1UL << 0) | (1UL << 2);
    VELXIO_RCC_APB1ENR |= (1UL << 17);

    // PA2 = USART2_TX alternate push-pull 50MHz, PA3 = floating input.
    uint32_t crl = VELXIO_GPIOA_CRL;
    crl &= ~((0xfUL << 8) | (0xfUL << 12));
    crl |= (0xbUL << 8) | (0x4UL << 12);
    VELXIO_GPIOA_CRL = crl;

    uint32_t clock = 8000000UL;
#if defined(F_CPU)
    clock = (uint32_t)F_CPU;
#endif
    if (SystemCoreClock != 0) {
      clock = SystemCoreClock;
    }
    VELXIO_USART2_BRR = (clock + (baud / 2UL)) / baud;
    VELXIO_USART2_CR1 = (1UL << 13) | (1UL << 3) | (1UL << 2);
    configured = true;
  }
};

static VelxioRenodeUsart2Serial VelxioSerial;
#define Serial VelxioSerial
#define Serial1 VelxioSerial

#ifndef VELXIO_RENODE_GPIO_SHIM
#define VELXIO_RENODE_GPIO_SHIM

#define VELXIO_GPIOA_IDR   VELXIO_REG32(0x40010808UL)
#define VELXIO_GPIOA_ODR   VELXIO_REG32(0x4001080CUL)
#define VELXIO_GPIOB_IDR   VELXIO_REG32(0x40010C08UL)
#define VELXIO_GPIOB_ODR   VELXIO_REG32(0x40010C0CUL)
#define VELXIO_GPIOC_IDR   VELXIO_REG32(0x40011008UL)
#define VELXIO_GPIOC_ODR   VELXIO_REG32(0x4001100CUL)

static inline int VelxioRenodeGpioIndex(uint32_t pin) {
#if defined(PA0)
  if (pin == PA0) return 0;
#endif
#if defined(PA1)
  if (pin == PA1) return 1;
#endif
#if defined(PA2)
  if (pin == PA2) return 2;
#endif
#if defined(PA3)
  if (pin == PA3) return 3;
#endif
#if defined(PA4)
  if (pin == PA4) return 4;
#endif
#if defined(PA5)
  if (pin == PA5) return 5;
#endif
#if defined(PA6)
  if (pin == PA6) return 6;
#endif
#if defined(PA7)
  if (pin == PA7) return 7;
#endif
#if defined(PA8)
  if (pin == PA8) return 8;
#endif
#if defined(PA9)
  if (pin == PA9) return 9;
#endif
#if defined(PA10)
  if (pin == PA10) return 10;
#endif
#if defined(PA11)
  if (pin == PA11) return 11;
#endif
#if defined(PA12)
  if (pin == PA12) return 12;
#endif
#if defined(PA13)
  if (pin == PA13) return 13;
#endif
#if defined(PA14)
  if (pin == PA14) return 14;
#endif
#if defined(PA15)
  if (pin == PA15) return 15;
#endif
#if defined(PB0)
  if (pin == PB0) return 16;
#endif
#if defined(PB1)
  if (pin == PB1) return 17;
#endif
#if defined(PB2)
  if (pin == PB2) return 18;
#endif
#if defined(PB3)
  if (pin == PB3) return 19;
#endif
#if defined(PB4)
  if (pin == PB4) return 20;
#endif
#if defined(PB5)
  if (pin == PB5) return 21;
#endif
#if defined(PB6)
  if (pin == PB6) return 22;
#endif
#if defined(PB7)
  if (pin == PB7) return 23;
#endif
#if defined(PB8)
  if (pin == PB8) return 24;
#endif
#if defined(PB9)
  if (pin == PB9) return 25;
#endif
#if defined(PB10)
  if (pin == PB10) return 26;
#endif
#if defined(PB11)
  if (pin == PB11) return 27;
#endif
#if defined(PB12)
  if (pin == PB12) return 28;
#endif
#if defined(PB13)
  if (pin == PB13) return 29;
#endif
#if defined(PB14)
  if (pin == PB14) return 30;
#endif
#if defined(PB15)
  if (pin == PB15) return 31;
#endif
#if defined(PC0)
  if (pin == PC0) return 32;
#endif
#if defined(PC1)
  if (pin == PC1) return 33;
#endif
#if defined(PC2)
  if (pin == PC2) return 34;
#endif
#if defined(PC3)
  if (pin == PC3) return 35;
#endif
#if defined(PC4)
  if (pin == PC4) return 36;
#endif
#if defined(PC5)
  if (pin == PC5) return 37;
#endif
#if defined(PC6)
  if (pin == PC6) return 38;
#endif
#if defined(PC7)
  if (pin == PC7) return 39;
#endif
#if defined(PC8)
  if (pin == PC8) return 40;
#endif
#if defined(PC9)
  if (pin == PC9) return 41;
#endif
#if defined(PC10)
  if (pin == PC10) return 42;
#endif
#if defined(PC11)
  if (pin == PC11) return 43;
#endif
#if defined(PC12)
  if (pin == PC12) return 44;
#endif
#if defined(PC13)
  if (pin == PC13) return 45;
#endif
#if defined(PC14)
  if (pin == PC14) return 46;
#endif
#if defined(PC15)
  if (pin == PC15) return 47;
#endif
  if (pin < 64) return (int)pin;
  return -1;
}

static inline volatile uint32_t *VelxioRenodeGpioOdr(int linear) {
  switch (linear / 16) {
    case 0: return &VELXIO_GPIOA_ODR;
    case 1: return &VELXIO_GPIOB_ODR;
    case 2: return &VELXIO_GPIOC_ODR;
    default: return nullptr;
  }
}

static inline volatile uint32_t *VelxioRenodeGpioIdr(int linear) {
  switch (linear / 16) {
    case 0: return &VELXIO_GPIOA_IDR;
    case 1: return &VELXIO_GPIOB_IDR;
    case 2: return &VELXIO_GPIOC_IDR;
    default: return nullptr;
  }
}

static inline void VelxioRenodeWriteLinearGpio(int linear, int value) {
  volatile uint32_t *odr = VelxioRenodeGpioOdr(linear);
  if (!odr) return;
  uint32_t mask = 1UL << (linear & 0x0f);
  if (value) {
    *odr |= mask;
  } else {
    *odr &= ~mask;
  }
}

extern "C" {
volatile uint32_t VelxioRenodeDigitalWriteTraceSink __attribute__((used)) = 0;

__attribute__((weak, noinline, used)) void VelxioRenodeDigitalWriteTrace(uint32_t linearPin, int value) {
  VelxioRenodeDigitalWriteTraceSink = ((linearPin & 0xffU) << 1) | (value ? 1U : 0U);
}
}

static __attribute__((noinline)) void VelxioRenodePinMode(uint32_t pin, uint32_t mode) {
  int linear = VelxioRenodeGpioIndex(pin);
  if (linear < 0) return;
  int port = linear / 16;
  if (port >= 0 && port <= 2) {
    VELXIO_RCC_APB2ENR |= (1UL << (2 + port));
  }
#if defined(INPUT_PULLUP)
  if (mode == INPUT_PULLUP) {
    VelxioRenodeWriteLinearGpio(linear, 1);
  }
#endif
#if defined(INPUT_PULLDOWN)
  if (mode == INPUT_PULLDOWN) {
    VelxioRenodeWriteLinearGpio(linear, 0);
  }
#endif
}

static __attribute__((noinline)) void VelxioRenodeDigitalWrite(uint32_t pin, int value) {
  int linear = VelxioRenodeGpioIndex(pin);
  if (linear >= 0) {
    VelxioRenodeWriteLinearGpio(linear, value ? 1 : 0);
    VelxioRenodeDigitalWriteTrace((uint32_t)linear, value ? 1 : 0);
  }
}

static __attribute__((noinline)) int VelxioRenodeDigitalRead(uint32_t pin) {
  int linear = VelxioRenodeGpioIndex(pin);
  if (linear < 0) return LOW;
  volatile uint32_t *idr = VelxioRenodeGpioIdr(linear);
  if (!idr) return LOW;
  return ((*idr & (1UL << (linear & 0x0f))) != 0) ? HIGH : LOW;
}

#define pinMode(pin, mode) VelxioRenodePinMode((uint32_t)(pin), (uint32_t)(mode))
#define digitalWrite(pin, value) VelxioRenodeDigitalWrite((uint32_t)(pin), (int)(value))
#define digitalRead(pin) VelxioRenodeDigitalRead((uint32_t)(pin))
#endif

extern "C" __attribute__((noinline, used)) void VelxioRenodeAnalogWrite(uint32_t pin, int value) {
  VelxioRenodePinMode(pin, OUTPUT);
  VelxioRenodeDigitalWrite(pin, value > 0 ? HIGH : LOW);
}

extern "C" {
volatile uint32_t VelxioRenodeAdcRawValues[64] __attribute__((section(".noinit"), used));
volatile uint32_t VelxioRenodeAdcConfigured[64] __attribute__((section(".noinit"), used));
volatile uint32_t VelxioRenodeAdcResolutionBits __attribute__((used)) = 10;
}

static inline int VelxioRenodeAdcIndex(uint32_t pin) {
#if defined(PA0)
  if (pin == PA0) return 0;
#endif
#if defined(PA1)
  if (pin == PA1) return 1;
#endif
#if defined(PA2)
  if (pin == PA2) return 2;
#endif
#if defined(PA3)
  if (pin == PA3) return 3;
#endif
#if defined(PA4)
  if (pin == PA4) return 4;
#endif
#if defined(PA5)
  if (pin == PA5) return 5;
#endif
#if defined(PA6)
  if (pin == PA6) return 6;
#endif
#if defined(PA7)
  if (pin == PA7) return 7;
#endif
#if defined(PB0)
  if (pin == PB0) return 16;
#endif
#if defined(PB1)
  if (pin == PB1) return 17;
#endif
#if defined(PC0)
  if (pin == PC0) return 32;
#endif
#if defined(PC1)
  if (pin == PC1) return 33;
#endif
#if defined(PC2)
  if (pin == PC2) return 34;
#endif
#if defined(PC3)
  if (pin == PC3) return 35;
#endif
#if defined(PC4)
  if (pin == PC4) return 36;
#endif
#if defined(PC5)
  if (pin == PC5) return 37;
#endif
#if defined(A0)
  if (pin == A0) return 0;
#endif
#if defined(A1)
  if (pin == A1) return 1;
#endif
#if defined(A2)
  if (pin == A2) return 2;
#endif
#if defined(A3)
  if (pin == A3) return 3;
#endif
#if defined(A4)
  if (pin == A4) return 4;
#endif
#if defined(A5)
  if (pin == A5) return 5;
#endif
#if defined(A6)
  if (pin == A6) return 6;
#endif
#if defined(A7)
  if (pin == A7) return 7;
#endif
  if (pin < 64) return (int)pin;
  return -1;
}

static inline uint32_t VelxioRenodeDefaultAdcRaw12(int index) {
  switch (index) {
    case 0: return 2048;
    case 1: return 2560;
    case 2: return 1536;
    case 3: return 3072;
    default: return 2048;
  }
}

static inline int VelxioRenodeScaleAdcRaw(uint32_t raw12) {
  uint32_t bits = VelxioRenodeAdcResolutionBits;
  if (bits < 1) bits = 1;
  if (bits > 16) bits = 16;
  raw12 &= 0x0fffU;
  if (bits == 12) return (int)raw12;
  if (bits < 12) return (int)(raw12 >> (12 - bits));
  return (int)(raw12 << (bits - 12));
}

extern "C" __attribute__((noinline, used)) int VelxioRenodeAnalogRead(uint32_t pin) {
  int index = VelxioRenodeAdcIndex(pin);
  uint32_t raw12 = VelxioRenodeDefaultAdcRaw12(index);
  if (index >= 0 && index < 64 && VelxioRenodeAdcConfigured[index]) {
    raw12 = VelxioRenodeAdcRawValues[index] & 0x0fffU;
  }
  return VelxioRenodeScaleAdcRaw(raw12);
}

extern "C" __attribute__((noinline, used)) void VelxioRenodeAnalogReadResolution(int bits) {
  if (bits < 1) bits = 1;
  if (bits > 16) bits = 16;
  VelxioRenodeAdcResolutionBits = (uint32_t)bits;
}

#define analogWrite(pin, value) VelxioRenodeAnalogWrite((uint32_t)(pin), (int)(value))
#define analogRead(pin) VelxioRenodeAnalogRead((uint32_t)(pin))
#define analogReadResolution(bits) VelxioRenodeAnalogReadResolution((int)(bits))
#endif

"""

STM32_RENODE_WIRE_SHIM = r"""// Velxio STM32/Renode shim: keep Arduino Wire-compatible sketches
// moving under Renode's STM32F103 model. STM32duino's normal Wire.begin()
// enters HAL bus recovery / I2C init paths that can block indefinitely when the
// emulated I2C pins are not driven like a real pull-up bus. This replacement
// implements the TwoWire symbols the linker needs and provides a small virtual
// register device at 0x76 for the current BMP280 examples.
#if defined(ARDUINO_ARCH_STM32)
#include <Arduino.h>
#include <Wire.h>
#include <stdlib.h>
#include <string.h>

namespace {
uint8_t velxio_i2c_register = 0;
uint8_t velxio_bmp280_regs[256];
bool velxio_bmp280_ready = false;

void velxio_put_u16_le(uint8_t reg, uint16_t value) {
  velxio_bmp280_regs[reg] = (uint8_t)(value & 0xffU);
  velxio_bmp280_regs[(uint8_t)(reg + 1)] = (uint8_t)(value >> 8);
}

void velxio_init_bmp280() {
  if (velxio_bmp280_ready) return;
  memset(velxio_bmp280_regs, 0, sizeof(velxio_bmp280_regs));
  velxio_bmp280_regs[0xD0] = 0x58; // BMP280 chip id.
  velxio_bmp280_regs[0xF3] = 0x00; // status: measuring=false, im_update=false.

  // Calibration constants from the Bosch BMP280 datasheet example.
  velxio_put_u16_le(0x88, 27504);
  velxio_put_u16_le(0x8A, (uint16_t)26435);
  velxio_put_u16_le(0x8C, (uint16_t)-1000);
  velxio_put_u16_le(0x8E, 36477);
  velxio_put_u16_le(0x90, (uint16_t)-10685);
  velxio_put_u16_le(0x92, 3024);
  velxio_put_u16_le(0x94, 2855);
  velxio_put_u16_le(0x96, 140);
  velxio_put_u16_le(0x98, (uint16_t)-7);
  velxio_put_u16_le(0x9A, 15500);
  velxio_put_u16_le(0x9C, (uint16_t)-14600);
  velxio_put_u16_le(0x9E, 6000);

  // Raw pressure/temp samples matching the same datasheet coefficient set.
  velxio_bmp280_regs[0xF7] = 0x65;
  velxio_bmp280_regs[0xF8] = 0x5A;
  velxio_bmp280_regs[0xF9] = 0xC0;
  velxio_bmp280_regs[0xFA] = 0x7E;
  velxio_bmp280_regs[0xFB] = 0xED;
  velxio_bmp280_regs[0xFC] = 0x00;
  velxio_bmp280_ready = true;
}

bool velxio_is_virtual_i2c_addr(uint8_t address) {
  return address == 0x76 || address == 0x77;
}
} // namespace

TwoWire::TwoWire(uint32_t sda, uint32_t scl) {
  memset((void *)&_i2c, 0, sizeof(_i2c));
  _i2c.sda = digitalPinToPinName(sda);
  _i2c.scl = digitalPinToPinName(scl);
  txBuffer = nullptr;
  txBufferAllocated = 0;
  txDataSize = 0;
  txAddress = 0;
  transmitting = 0;
  rxBuffer = nullptr;
  rxBufferAllocated = 0;
  rxBufferIndex = 0;
  rxBufferLength = 0;
  ownAddress = 0;
}

TwoWire::~TwoWire() {
  end();
}

void TwoWire::begin(uint32_t sda, uint32_t scl) {
  _i2c.sda = digitalPinToPinName(sda);
  _i2c.scl = digitalPinToPinName(scl);
  begin();
}

void TwoWire::begin(bool generalCall) {
  begin((uint8_t)0x01, generalCall, false);
}

void TwoWire::begin(uint8_t address, bool generalCall, bool NoStretchMode) {
  (void)generalCall;
  (void)NoStretchMode;
  rxBufferIndex = 0;
  rxBufferLength = 0;
  txDataSize = 0;
  txAddress = 0;
  transmitting = 0;
  ownAddress = (uint8_t)(address << 1);
  velxio_init_bmp280();
}

void TwoWire::begin(int address, bool generalCall, bool NoStretchMode) {
  begin((uint8_t)address, generalCall, NoStretchMode);
}

void TwoWire::end(void) {
  if (txBuffer != nullptr) {
    free(txBuffer);
    txBuffer = nullptr;
  }
  txBufferAllocated = 0;
  txDataSize = 0;
  if (rxBuffer != nullptr) {
    free(rxBuffer);
    rxBuffer = nullptr;
  }
  rxBufferAllocated = 0;
  rxBufferIndex = 0;
  rxBufferLength = 0;
}

void TwoWire::setClock(uint32_t frequency) {
  (void)frequency;
}

void TwoWire::beginTransmission(uint8_t address) {
  transmitting = 1;
  txAddress = (uint8_t)(address << 1);
  txDataSize = 0;
}

void TwoWire::beginTransmission(int address) {
  beginTransmission((uint8_t)address);
}

uint8_t TwoWire::endTransmission(uint8_t sendStop) {
  (void)sendStop;
  uint8_t address = (uint8_t)(txAddress >> 1);
  if (!velxio_is_virtual_i2c_addr(address)) {
    txDataSize = 0;
    transmitting = 0;
    return 2; // NACK address
  }
  velxio_init_bmp280();
  if (txDataSize > 0 && txBuffer != nullptr) {
    velxio_i2c_register = txBuffer[0];
    for (uint16_t i = 1; i < txDataSize; i++) {
      velxio_bmp280_regs[(uint8_t)(velxio_i2c_register + i - 1)] = txBuffer[i];
    }
  }
  txDataSize = 0;
  transmitting = 0;
  return 0;
}

uint8_t TwoWire::endTransmission(void) {
  return endTransmission((uint8_t)true);
}

uint8_t TwoWire::requestFrom(uint8_t address, uint8_t quantity, uint32_t iaddress, uint8_t isize, uint8_t sendStop) {
  (void)sendStop;
  if (isize > 0) {
    velxio_i2c_register = (uint8_t)(iaddress & 0xffU);
  }
  allocateRxBuffer(quantity);
  rxBufferIndex = 0;
  rxBufferLength = 0;
  if (!velxio_is_virtual_i2c_addr(address) || rxBuffer == nullptr) {
    return 0;
  }
  velxio_init_bmp280();
  for (uint8_t i = 0; i < quantity; i++) {
    rxBuffer[i] = velxio_bmp280_regs[(uint8_t)(velxio_i2c_register + i)];
  }
  rxBufferLength = quantity;
  velxio_i2c_register = (uint8_t)(velxio_i2c_register + quantity);
  return quantity;
}

uint8_t TwoWire::requestFrom(uint8_t address, uint8_t quantity, uint8_t sendStop) {
  return requestFrom(address, quantity, (uint32_t)0, (uint8_t)0, sendStop);
}

uint8_t TwoWire::requestFrom(uint8_t address, size_t quantity, bool sendStop) {
  return requestFrom(address, (uint8_t)quantity, (uint8_t)sendStop);
}

uint8_t TwoWire::requestFrom(uint8_t address, uint8_t quantity) {
  return requestFrom(address, quantity, (uint8_t)true);
}

uint8_t TwoWire::requestFrom(int address, int quantity) {
  return requestFrom((uint8_t)address, (uint8_t)quantity, (uint8_t)true);
}

uint8_t TwoWire::requestFrom(int address, int quantity, int sendStop) {
  return requestFrom((uint8_t)address, (uint8_t)quantity, (uint8_t)sendStop);
}

size_t TwoWire::write(uint8_t data) {
  if (!transmitting) return 1;
  if (allocateTxBuffer((size_t)txDataSize + 1U) == 0) return 0;
  txBuffer[txDataSize++] = data;
  return 1;
}

size_t TwoWire::write(const uint8_t *data, size_t quantity) {
  if (!data) return 0;
  if (!transmitting) return quantity;
  if (allocateTxBuffer((size_t)txDataSize + quantity) == 0) return 0;
  memcpy(&(txBuffer[txDataSize]), data, quantity);
  txDataSize += (uint16_t)quantity;
  return quantity;
}

int TwoWire::available(void) {
  return (int)(rxBufferLength - rxBufferIndex);
}

int TwoWire::read(void) {
  if (rxBufferIndex >= rxBufferLength || rxBuffer == nullptr) return -1;
  return rxBuffer[rxBufferIndex++];
}

int TwoWire::peek(void) {
  if (rxBufferIndex >= rxBufferLength || rxBuffer == nullptr) return -1;
  return rxBuffer[rxBufferIndex];
}

void TwoWire::flush(void) {
  rxBufferIndex = 0;
  rxBufferLength = 0;
  txDataSize = 0;
}

void TwoWire::onReceive(cb_function_receive_t callback) {
  user_onReceive = callback;
}

void TwoWire::onRequest(cb_function_request_t callback) {
  user_onRequest = callback;
}

void TwoWire::onRequestService(i2c_t *) {}
void TwoWire::onReceiveService(i2c_t *) {}

void TwoWire::allocateRxBuffer(size_t length) {
  if (rxBufferAllocated >= length) return;
  if (length < BUFFER_LENGTH) length = BUFFER_LENGTH;
  uint8_t *tmp = (uint8_t *)realloc(rxBuffer, length);
  if (tmp != nullptr) {
    rxBuffer = tmp;
    rxBufferAllocated = (uint16_t)length;
  }
}

size_t TwoWire::allocateTxBuffer(size_t length) {
  if (length > WIRE_MAX_TX_BUFF_LENGTH) return 0;
  if (txBufferAllocated >= length) return length;
  if (length < BUFFER_LENGTH) length = BUFFER_LENGTH;
  uint8_t *tmp = (uint8_t *)realloc(txBuffer, length);
  if (tmp == nullptr) return 0;
  txBuffer = tmp;
  txBufferAllocated = (uint16_t)length;
  return length;
}

void TwoWire::resetRxBuffer(void) {
  if (rxBuffer != nullptr) memset(rxBuffer, 0, rxBufferAllocated);
}

void TwoWire::resetTxBuffer(void) {
  if (txBuffer != nullptr) memset(txBuffer, 0, txBufferAllocated);
}

void TwoWire::recoverBus(void) {}

TwoWire Wire = TwoWire();
#endif
"""

STM32_RENODE_WIRE_HEADER = r"""// Velxio STM32/Renode local Wire.h
// Shadows STM32duino's Wire library during simulation builds so library code
// using TwoWire does not enter HAL I2C paths that block in Renode.
#ifndef TwoWire_h
#define TwoWire_h

#include <Arduino.h>
#include <Stream.h>
#include <functional>

#define BUFFER_LENGTH 32
#if !defined(WIRE_MAX_TX_BUFF_LENGTH)
#define WIRE_MAX_TX_BUFF_LENGTH 1024U
#endif
#define WIRE_HAS_END 1

class TwoWire : public Stream {
public:
  typedef std::function<void(int)> cb_function_receive_t;
  typedef std::function<void(void)> cb_function_request_t;

  TwoWire(uint32_t sda = SDA, uint32_t scl = SCL);
  ~TwoWire();

  void setSCL(uint32_t scl) { (void)scl; }
  void setSDA(uint32_t sda) { (void)sda; }
#if defined(ARDUINO_ARCH_STM32)
  void setSCL(PinName scl) { (void)scl; }
  void setSDA(PinName sda) { (void)sda; }
#endif

  void begin(bool generalCall = false);
  void begin(uint32_t sda, uint32_t scl);
  void begin(uint8_t address, bool generalCall = false, bool NoStretchMode = false);
  void begin(int address, bool generalCall = false, bool NoStretchMode = false);
  void end();
  void setClock(uint32_t frequency);
  void beginTransmission(uint8_t address) __attribute__((noinline));
  void beginTransmission(int address);
  uint8_t endTransmission(void);
  uint8_t endTransmission(uint8_t sendStop) __attribute__((noinline));
  uint8_t requestFrom(uint8_t address, uint8_t quantity);
  uint8_t requestFrom(uint8_t address, uint8_t quantity, uint8_t sendStop);
  uint8_t requestFrom(uint8_t address, size_t quantity, bool sendStop);
  uint8_t requestFrom(uint8_t address, uint8_t quantity, uint32_t iaddress, uint8_t isize, uint8_t sendStop);
  uint8_t requestFrom(int address, int quantity);
  uint8_t requestFrom(int address, int quantity, int sendStop);
  virtual size_t write(uint8_t data) __attribute__((noinline));
  virtual size_t write(const uint8_t *data, size_t quantity);
  virtual int available(void);
  virtual int read(void);
  virtual int peek(void);
  virtual void flush(void);
  void onReceive(cb_function_receive_t callback);
  void onRequest(cb_function_request_t callback);

  inline size_t write(unsigned long n) { return write((uint8_t)n); }
  inline size_t write(long n) { return write((uint8_t)n); }
  inline size_t write(unsigned int n) { return write((uint8_t)n); }
  inline size_t write(int n) { return write((uint8_t)n); }
  using Print::write;

private:
  uint8_t rxBuffer[64];
  uint16_t rxBufferIndex;
  uint16_t rxBufferLength;
  uint8_t txBuffer[64];
  uint16_t txDataSize;
  uint8_t txAddress;
  uint8_t transmitting;
  cb_function_receive_t user_onReceive;
  cb_function_request_t user_onRequest;
};

extern TwoWire Wire;

#endif
"""

STM32_RENODE_WIRE_IMPL = r"""// Velxio STM32/Renode local Wire implementation
#if defined(ARDUINO_ARCH_STM32)
#include "Wire.h"
#include <string.h>

namespace {
uint8_t velxio_i2c_register = 0;
uint8_t velxio_bmp280_regs[256];
bool velxio_bmp280_ready = false;

void velxio_put_u16_le(uint8_t reg, uint16_t value) {
  velxio_bmp280_regs[reg] = (uint8_t)(value & 0xffU);
  velxio_bmp280_regs[(uint8_t)(reg + 1)] = (uint8_t)(value >> 8);
}

void velxio_init_bmp280() {
  if (velxio_bmp280_ready) return;
  memset(velxio_bmp280_regs, 0, sizeof(velxio_bmp280_regs));
  velxio_bmp280_regs[0xD0] = 0x58;
  velxio_bmp280_regs[0xF3] = 0x00;
  velxio_put_u16_le(0x88, 27504);
  velxio_put_u16_le(0x8A, (uint16_t)26435);
  velxio_put_u16_le(0x8C, (uint16_t)-1000);
  velxio_put_u16_le(0x8E, 36477);
  velxio_put_u16_le(0x90, (uint16_t)-10685);
  velxio_put_u16_le(0x92, 3024);
  velxio_put_u16_le(0x94, 2855);
  velxio_put_u16_le(0x96, 140);
  velxio_put_u16_le(0x98, (uint16_t)-7);
  velxio_put_u16_le(0x9A, 15500);
  velxio_put_u16_le(0x9C, (uint16_t)-14600);
  velxio_put_u16_le(0x9E, 6000);
  velxio_bmp280_regs[0xF7] = 0x65;
  velxio_bmp280_regs[0xF8] = 0x5A;
  velxio_bmp280_regs[0xF9] = 0xC0;
  velxio_bmp280_regs[0xFA] = 0x7E;
  velxio_bmp280_regs[0xFB] = 0xED;
  velxio_bmp280_regs[0xFC] = 0x00;
  velxio_bmp280_ready = true;
}

bool velxio_ack(uint8_t address) {
  return address == 0x76 || address == 0x77 || address == 0x3C || address == 0x68;
}

uint8_t velxio_read_reg(uint8_t address, uint8_t reg) {
  if (address == 0x76 || address == 0x77) {
    velxio_init_bmp280();
    return velxio_bmp280_regs[reg];
  }
  if (address == 0x68) {
    if (reg == 0x75) return 0x68; // MPU6050 WHO_AM_I.
    if (reg == 0x3B) return 0x00; // MPU6050 accel X high.
    if (reg == 0x3C) return 0x00;
    if (reg == 0x3D) return 0x00; // accel Y.
    if (reg == 0x3E) return 0x00;
    if (reg == 0x3F) return 0x40; // accel Z = 0x4000, roughly 1 g.
    if (reg == 0x40) return 0x00;
    static const uint8_t ds1307_now[7] = {
      0x56, // seconds
      0x34, // minutes
      0x12, // hours
      0x02, // day-of-week
      0x23, // day
      0x06, // month
      0x26, // year
    };
    if (reg < sizeof(ds1307_now)) return ds1307_now[reg];
  }
  return 0x00;
}
} // namespace

TwoWire::TwoWire(uint32_t sda, uint32_t scl) {
  (void)sda;
  (void)scl;
  rxBufferIndex = 0;
  rxBufferLength = 0;
  txDataSize = 0;
  txAddress = 0;
  transmitting = 0;
}

TwoWire::~TwoWire() {
  end();
}

void TwoWire::begin(uint32_t sda, uint32_t scl) {
  (void)sda;
  (void)scl;
  begin();
}

void TwoWire::begin(bool generalCall) {
  begin((uint8_t)0x01, generalCall, false);
}

void TwoWire::begin(uint8_t address, bool generalCall, bool NoStretchMode) {
  (void)address;
  (void)generalCall;
  (void)NoStretchMode;
  rxBufferIndex = 0;
  rxBufferLength = 0;
  txDataSize = 0;
  transmitting = 0;
  velxio_init_bmp280();
}

void TwoWire::begin(int address, bool generalCall, bool NoStretchMode) {
  begin((uint8_t)address, generalCall, NoStretchMode);
}

void TwoWire::end(void) {
  rxBufferIndex = 0;
  rxBufferLength = 0;
  txDataSize = 0;
  transmitting = 0;
}

void TwoWire::setClock(uint32_t frequency) {
  (void)frequency;
}

__attribute__((noinline)) void TwoWire::beginTransmission(uint8_t address) {
  transmitting = 1;
  txAddress = address;
  txDataSize = 0;
}

void TwoWire::beginTransmission(int address) {
  beginTransmission((uint8_t)address);
}

__attribute__((noinline)) uint8_t TwoWire::endTransmission(uint8_t sendStop) {
  (void)sendStop;
  if (!velxio_ack(txAddress)) {
    txDataSize = 0;
    transmitting = 0;
    return 2;
  }
  if (txDataSize > 0) {
    velxio_i2c_register = txBuffer[0];
    if (txAddress == 0x76 || txAddress == 0x77) {
      velxio_init_bmp280();
      for (uint16_t i = 1; i < txDataSize; i++) {
        velxio_bmp280_regs[(uint8_t)(velxio_i2c_register + i - 1)] = txBuffer[i];
      }
    }
  }
  txDataSize = 0;
  transmitting = 0;
  return 0;
}

uint8_t TwoWire::endTransmission(void) {
  return endTransmission((uint8_t)true);
}

uint8_t TwoWire::requestFrom(uint8_t address, uint8_t quantity, uint32_t iaddress, uint8_t isize, uint8_t sendStop) {
  (void)sendStop;
  if (isize > 0) {
    velxio_i2c_register = (uint8_t)(iaddress & 0xffU);
  }
  rxBufferIndex = 0;
  rxBufferLength = 0;
  if (!velxio_ack(address)) return 0;
  if (quantity > sizeof(rxBuffer)) quantity = sizeof(rxBuffer);
  for (uint8_t i = 0; i < quantity; i++) {
    rxBuffer[i] = velxio_read_reg(address, (uint8_t)(velxio_i2c_register + i));
  }
  rxBufferLength = quantity;
  velxio_i2c_register = (uint8_t)(velxio_i2c_register + quantity);
  return quantity;
}

uint8_t TwoWire::requestFrom(uint8_t address, uint8_t quantity, uint8_t sendStop) {
  return requestFrom(address, quantity, (uint32_t)0, (uint8_t)0, sendStop);
}

uint8_t TwoWire::requestFrom(uint8_t address, size_t quantity, bool sendStop) {
  return requestFrom(address, (uint8_t)quantity, (uint8_t)sendStop);
}

uint8_t TwoWire::requestFrom(uint8_t address, uint8_t quantity) {
  return requestFrom(address, quantity, (uint8_t)true);
}

uint8_t TwoWire::requestFrom(int address, int quantity) {
  return requestFrom((uint8_t)address, (uint8_t)quantity, (uint8_t)true);
}

uint8_t TwoWire::requestFrom(int address, int quantity, int sendStop) {
  return requestFrom((uint8_t)address, (uint8_t)quantity, (uint8_t)sendStop);
}

__attribute__((noinline)) size_t TwoWire::write(uint8_t data) {
  if (!transmitting) return 1;
  if (txDataSize >= sizeof(txBuffer)) return 0;
  txBuffer[txDataSize++] = data;
  return 1;
}

size_t TwoWire::write(const uint8_t *data, size_t quantity) {
  if (!data) return 0;
  if (!transmitting) return quantity;
  size_t written = 0;
  for (size_t i = 0; i < quantity; i++) {
    if (write(data[i]) == 0) {
      break;
    }
    written++;
  }
  return written;
}

int TwoWire::available(void) {
  return (int)(rxBufferLength - rxBufferIndex);
}

int TwoWire::read(void) {
  if (rxBufferIndex >= rxBufferLength) return -1;
  return rxBuffer[rxBufferIndex++];
}

int TwoWire::peek(void) {
  if (rxBufferIndex >= rxBufferLength) return -1;
  return rxBuffer[rxBufferIndex];
}

void TwoWire::flush(void) {
  rxBufferIndex = 0;
  rxBufferLength = 0;
  txDataSize = 0;
}

void TwoWire::onReceive(cb_function_receive_t callback) {
  user_onReceive = callback;
}

void TwoWire::onRequest(cb_function_request_t callback) {
  user_onRequest = callback;
}

TwoWire Wire = TwoWire();
#endif
"""

STM32_RENODE_SPI_HEADER = r"""// Velxio STM32/Renode local SPI.h
// Shadows STM32duino's SPI library during simulation builds. The hardware SPI
// HAL path can block in Renode's current F103 platform when no modeled SPI
// partner drives the bus, so transfers return deterministic loopback bytes.
#ifndef VELXIO_RENODE_SPI_H
#define VELXIO_RENODE_SPI_H

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

#ifndef SPI_MODE0
#define SPI_MODE0 0x00
#endif
#ifndef SPI_MODE1
#define SPI_MODE1 0x01
#endif
#ifndef SPI_MODE2
#define SPI_MODE2 0x02
#endif
#ifndef SPI_MODE3
#define SPI_MODE3 0x03
#endif

#ifndef SPI_HAS_TRANSACTION
#define SPI_HAS_TRANSACTION 1
#endif

#ifndef SPI_CLOCK_DIV2
#define SPI_CLOCK_DIV2 0x04
#endif
#ifndef SPI_CLOCK_DIV4
#define SPI_CLOCK_DIV4 0x00
#endif
#ifndef SPI_CLOCK_DIV8
#define SPI_CLOCK_DIV8 0x05
#endif
#ifndef SPI_CLOCK_DIV16
#define SPI_CLOCK_DIV16 0x01
#endif
#ifndef SPI_CLOCK_DIV32
#define SPI_CLOCK_DIV32 0x06
#endif
#ifndef SPI_CLOCK_DIV64
#define SPI_CLOCK_DIV64 0x02
#endif
#ifndef SPI_CLOCK_DIV128
#define SPI_CLOCK_DIV128 0x03
#endif

class SPISettings {
public:
  SPISettings(uint32_t clock = 4000000UL, BitOrder bitOrder = MSBFIRST, uint8_t dataMode = SPI_MODE0)
    : clockFreq(clock), bitOrderValue(bitOrder), dataModeValue(dataMode) {}

  uint32_t clockFreq;
  BitOrder bitOrderValue;
  uint8_t dataModeValue;
};

extern "C" __attribute__((noinline, used)) uint8_t VelxioRenodeSpiTransfer(uint8_t data);
extern "C" __attribute__((noinline, used)) void VelxioRenodeDigitalWriteTrace(uint32_t linearPin, int value);

#ifndef VELXIO_RENODE_GPIO_SHIM
#define VELXIO_RENODE_GPIO_SHIM
static inline int VelxioRenodeGpioIndex(uint32_t pin) {
#if defined(PA0)
  if (pin == PA0) return 0;
#endif
#if defined(PA1)
  if (pin == PA1) return 1;
#endif
#if defined(PA2)
  if (pin == PA2) return 2;
#endif
#if defined(PA3)
  if (pin == PA3) return 3;
#endif
#if defined(PA4)
  if (pin == PA4) return 4;
#endif
#if defined(PA5)
  if (pin == PA5) return 5;
#endif
#if defined(PA6)
  if (pin == PA6) return 6;
#endif
#if defined(PA7)
  if (pin == PA7) return 7;
#endif
#if defined(PA8)
  if (pin == PA8) return 8;
#endif
#if defined(PA9)
  if (pin == PA9) return 9;
#endif
#if defined(PA10)
  if (pin == PA10) return 10;
#endif
#if defined(PA11)
  if (pin == PA11) return 11;
#endif
#if defined(PA12)
  if (pin == PA12) return 12;
#endif
#if defined(PA13)
  if (pin == PA13) return 13;
#endif
#if defined(PA14)
  if (pin == PA14) return 14;
#endif
#if defined(PA15)
  if (pin == PA15) return 15;
#endif
#if defined(PB0)
  if (pin == PB0) return 16;
#endif
#if defined(PB1)
  if (pin == PB1) return 17;
#endif
#if defined(PB2)
  if (pin == PB2) return 18;
#endif
#if defined(PB3)
  if (pin == PB3) return 19;
#endif
#if defined(PB4)
  if (pin == PB4) return 20;
#endif
#if defined(PB5)
  if (pin == PB5) return 21;
#endif
#if defined(PB6)
  if (pin == PB6) return 22;
#endif
#if defined(PB7)
  if (pin == PB7) return 23;
#endif
#if defined(PB8)
  if (pin == PB8) return 24;
#endif
#if defined(PB9)
  if (pin == PB9) return 25;
#endif
#if defined(PB10)
  if (pin == PB10) return 26;
#endif
#if defined(PB11)
  if (pin == PB11) return 27;
#endif
#if defined(PB12)
  if (pin == PB12) return 28;
#endif
#if defined(PB13)
  if (pin == PB13) return 29;
#endif
#if defined(PB14)
  if (pin == PB14) return 30;
#endif
#if defined(PB15)
  if (pin == PB15) return 31;
#endif
#if defined(PC0)
  if (pin == PC0) return 32;
#endif
#if defined(PC1)
  if (pin == PC1) return 33;
#endif
#if defined(PC2)
  if (pin == PC2) return 34;
#endif
#if defined(PC3)
  if (pin == PC3) return 35;
#endif
#if defined(PC4)
  if (pin == PC4) return 36;
#endif
#if defined(PC5)
  if (pin == PC5) return 37;
#endif
#if defined(PC6)
  if (pin == PC6) return 38;
#endif
#if defined(PC7)
  if (pin == PC7) return 39;
#endif
#if defined(PC8)
  if (pin == PC8) return 40;
#endif
#if defined(PC9)
  if (pin == PC9) return 41;
#endif
#if defined(PC10)
  if (pin == PC10) return 42;
#endif
#if defined(PC11)
  if (pin == PC11) return 43;
#endif
#if defined(PC12)
  if (pin == PC12) return 44;
#endif
#if defined(PC13)
  if (pin == PC13) return 45;
#endif
#if defined(PC14)
  if (pin == PC14) return 46;
#endif
#if defined(PC15)
  if (pin == PC15) return 47;
#endif
  if (pin < 64) return (int)pin;
  return -1;
}

static __attribute__((noinline)) void VelxioRenodeDigitalWrite(uint32_t pin, int value) {
  (digitalWrite)(pin, value ? HIGH : LOW);
  int linear = VelxioRenodeGpioIndex(pin);
  if (linear >= 0) {
    VelxioRenodeDigitalWriteTrace((uint32_t)linear, value ? 1 : 0);
  }
}

#define digitalWrite(pin, value) VelxioRenodeDigitalWrite((uint32_t)(pin), (int)(value))
#endif

class SPIClass {
public:
  SPIClass() = default;
  SPIClass(uint32_t mosi, uint32_t miso, uint32_t sclk, uint32_t ssel = 0xFFFFFFFFUL)
    : mosiPin(mosi), misoPin(miso), sclkPin(sclk), sselPin(ssel) {}

  void begin();
  void begin(uint32_t ssel);
  void end();
  void beginTransaction(SPISettings settings);
  void endTransaction();
  uint8_t transfer(uint8_t data) __attribute__((noinline));
  uint16_t transfer16(uint16_t data);
  void transfer(void *buf, size_t count);
  void usingInterrupt(uint8_t interruptNumber);
  void notUsingInterrupt(uint8_t interruptNumber);
  void attachInterrupt();
  void detachInterrupt();
  void setBitOrder(BitOrder bitOrder);
  void setDataMode(uint8_t dataMode);
  void setClockDivider(uint8_t clockDiv);

private:
  SPISettings settings;
  bool active = false;
  uint32_t mosiPin = 0xFFFFFFFFUL;
  uint32_t misoPin = 0xFFFFFFFFUL;
  uint32_t sclkPin = 0xFFFFFFFFUL;
  uint32_t sselPin = 0xFFFFFFFFUL;
};

extern SPIClass SPI;

#endif
"""

STM32_RENODE_SPI_IMPL = r"""// Velxio STM32/Renode local SPI implementation
#if defined(ARDUINO_ARCH_STM32)
#include "SPI.h"

extern "C" volatile uint32_t VelxioRenodeSpiLastByte __attribute__((used));
extern "C" volatile uint32_t VelxioRenodeSpiLastByte = 0;

extern "C" __attribute__((noinline, used)) uint8_t VelxioRenodeSpiTransfer(uint8_t data) {
  VelxioRenodeSpiLastByte = data;
  return data;
}

extern "C" __attribute__((noinline, used)) void VelxioRenodeDigitalWriteTrace(uint32_t linearPin, int value) {
  (void)linearPin;
  (void)value;
}

void SPIClass::begin() {
  active = true;
}

void SPIClass::begin(uint32_t ssel) {
  sselPin = ssel;
  begin();
}

void SPIClass::end() {
  active = false;
}

void SPIClass::beginTransaction(SPISettings newSettings) {
  settings = newSettings;
  active = true;
}

void SPIClass::endTransaction() {
}

__attribute__((noinline)) uint8_t SPIClass::transfer(uint8_t data) {
  if (!active) {
    begin();
  }
  return VelxioRenodeSpiTransfer(data);
}

uint16_t SPIClass::transfer16(uint16_t data) {
  uint8_t hi = transfer(static_cast<uint8_t>(data >> 8));
  uint8_t lo = transfer(static_cast<uint8_t>(data & 0xffU));
  return static_cast<uint16_t>((static_cast<uint16_t>(hi) << 8) | lo);
}

void SPIClass::transfer(void *buf, size_t count) {
  if (!buf) {
    return;
  }
  uint8_t *bytes = static_cast<uint8_t *>(buf);
  for (size_t i = 0; i < count; ++i) {
    bytes[i] = transfer(bytes[i]);
  }
}

void SPIClass::usingInterrupt(uint8_t interruptNumber) {
  (void)interruptNumber;
}

void SPIClass::notUsingInterrupt(uint8_t interruptNumber) {
  (void)interruptNumber;
}

void SPIClass::attachInterrupt() {
}

void SPIClass::detachInterrupt() {
}

void SPIClass::setBitOrder(BitOrder bitOrder) {
  settings.bitOrderValue = bitOrder;
}

void SPIClass::setDataMode(uint8_t dataMode) {
  settings.dataModeValue = dataMode;
}

void SPIClass::setClockDivider(uint8_t clockDiv) {
  (void)clockDiv;
}

SPIClass SPI;
#endif
"""


def _resolve_arduino_cli_path(cli_path: str) -> str:
    explicit = os.environ.get("ARDUINO_CLI_BIN", "").strip()
    if explicit:
        return explicit

    resolved = shutil.which(cli_path)
    if resolved:
        return resolved

    if os.name == "nt" and cli_path == "arduino-cli":
        user_bin = Path.home() / "bin" / "arduino-cli.exe"
        if user_bin.exists():
            return str(user_bin)

    return cli_path


def _looks_like_missing_header(stderr: str | None) -> bool:
    return bool(stderr and _MISSING_HEADER_RE.search(stderr))


def _timeout_output(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _stm32_compile_cache_enabled() -> bool:
    return os.environ.get("VELXIO_STM32_COMPILE_CACHE", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _stm32_compile_cache_root() -> Path:
    configured = os.environ.get("VELXIO_STM32_COMPILE_CACHE_DIR", "").strip()
    if configured:
        return Path(configured)
    return Path(tempfile.gettempdir()) / "velxio-stm32-compile-cache"


def _stm32_shim_fingerprint() -> str:
    h = hashlib.sha256()
    for part in (
        STM32_RENODE_CLOCK_HOOK,
        STM32_RENODE_SERIAL_SHIM,
        STM32_RENODE_WIRE_HEADER,
        STM32_RENODE_WIRE_IMPL,
        STM32_RENODE_SPI_HEADER,
        STM32_RENODE_SPI_IMPL,
    ):
        h.update(part.encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()


def _stm32_compile_cache_key(
    files: list[dict],
    board_fqbn: str,
    board_options: dict | None,
    allowed_libraries: set[str] | None,
    owner_id: str | None,
) -> str:
    payload = {
        "schema": 1,
        "board_fqbn": board_fqbn,
        "board_options": board_options or {},
        "files": [
            {
                "name": str(file_entry.get("name", "")),
                "content": str(file_entry.get("content", "")),
            }
            for file_entry in files
        ],
        "allowed_libraries": sorted(allowed_libraries) if allowed_libraries else [],
        "owner_id": owner_id or "",
        "fallback_sketchbook": os.environ.get("VELXIO_FALLBACK_SKETCHBOOK", ""),
        "shim": _stm32_shim_fingerprint(),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _stm32_compile_cache_read(key: str) -> dict | None:
    root = _stm32_compile_cache_root()
    entry = root / key
    meta_path = entry / "meta.json"
    firmware_path = entry / "firmware"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        raw = firmware_path.read_bytes()
    except Exception:
        return None
    if not raw:
        return None
    expected_sha = meta.get("sha256")
    actual_sha = hashlib.sha256(raw).hexdigest()
    if expected_sha and expected_sha != actual_sha:
        return None
    return {
        "binary_type": meta.get("binary_type") or "elf",
        "raw": raw,
    }


def _stm32_compile_cache_write(key: str, raw: bytes, binary_type: str) -> None:
    if not raw:
        return
    root = _stm32_compile_cache_root()
    entry = root / key
    tmp_entry = root / f".{key}.tmp"
    try:
        root.mkdir(parents=True, exist_ok=True)
        if tmp_entry.exists():
            shutil.rmtree(tmp_entry, ignore_errors=True)
        tmp_entry.mkdir(parents=True, exist_ok=True)
        (tmp_entry / "firmware").write_bytes(raw)
        (tmp_entry / "meta.json").write_text(
            json.dumps(
                {
                    "binary_type": binary_type,
                    "sha256": hashlib.sha256(raw).hexdigest(),
                },
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        if entry.exists():
            shutil.rmtree(entry, ignore_errors=True)
        tmp_entry.rename(entry)
    except Exception as exc:
        print(f"[STM32] Compile cache write skipped: {exc}")
        shutil.rmtree(tmp_entry, ignore_errors=True)


class ArduinoCLIService:
    # Board manager URLs for cores that aren't built-in
    CORE_URLS: dict[str, str] = {
        "rp2040:rp2040": "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json",
        "esp32:esp32": "https://espressif.github.io/arduino-esp32/package_esp32_index.json",
        # Spence Konde's ATTinyCore — needed for ATtiny85 FQBNs like
        #   ATTinyCore:avr:attinyx5:chip=85,clock=internal16mhz
        # Without it arduino-cli reports
        #   "Platform 'ATTinyCore:avr' not found: platform not installed".
        "ATTinyCore:avr": "http://drazzy.com/package_drazzy.com_index.json",
        # STM32duino (STM32 MCU family)
        "STMicroelectronics:stm32": "https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json",
    }

    # Cores to auto-install on startup
    REQUIRED_CORES = ["arduino:avr"]

    # Cores to install on-demand when a board FQBN is requested.
    # Match order matters: longer / more-specific prefixes first so we don't
    # mis-route (e.g. an FQBN that mentions both vendors).
    ON_DEMAND_CORES: dict[str, str] = {
        "ATTinyCore:avr": "ATTinyCore:avr",
        "rp2040": "rp2040:rp2040",
        "mbed_rp2040": "arduino:mbed_rp2040",
        "esp32": "esp32:esp32",
        "STMicroelectronics:stm32": "STMicroelectronics:stm32",
    }

    # Version pins for `arduino-cli core install`.  Keyed by core ID; if a core
    # is in this map we pass `<core>@<version>` instead of just `<core>`.
    # ATTinyCore: >=1.5.0 depends on micronucleus hosted at azduino.com, which
    # has been unreachable for extended periods.  1.4.1 is the last release
    # whose micronucleus tool is on github.com (digistump release) AND still
    # supports the FQBN options we use (clock=16pll, etc.). Compile-only —
    # micronucleus itself is never invoked here.
    CORE_INSTALL_VERSIONS: dict[str, str] = {
        "ATTinyCore:avr": "1.4.1",
    }

    def __init__(self, cli_path: str = "arduino-cli"):
        self.cli_path = _resolve_arduino_cli_path(cli_path)
        self._ensure_board_urls()
        self._ensure_core_installed()

    def _ensure_board_urls(self):
        """Register additional board-manager URLs in arduino-cli config."""
        try:
            # Ensure config file exists (arduino-cli requires it for config add)
            result = subprocess.run(
                [self.cli_path, "config", "dump", "--format", "json"],
                capture_output=True, text=True
            )
            import json
            try:
                cfg = json.loads(result.stdout)
            except Exception:
                cfg = {}

            # If config is empty/missing, initialize it
            config_dict = cfg.get("config", cfg)
            if not config_dict or config_dict == {}:
                print("[arduino-cli] Initializing config file...")
                subprocess.run(
                    [self.cli_path, "config", "init", "--overwrite"],
                    capture_output=True, text=True
                )

            # Re-read after init
            result = subprocess.run(
                [self.cli_path, "config", "dump", "--format", "json"],
                capture_output=True, text=True
            )
            try:
                cfg = json.loads(result.stdout)
            except Exception:
                cfg = {}

            existing = set()
            # Handle both flat and nested config shapes
            config_dict = cfg.get("config", cfg)
            bm = config_dict.get("board_manager", config_dict)
            urls = bm.get("additional_urls", [])
            if isinstance(urls, str):
                existing.add(urls)
            elif isinstance(urls, list):
                existing.update(urls)

            for url in self.CORE_URLS.values():
                if url not in existing:
                    print(f"[arduino-cli] Adding board manager URL: {url}")
                    subprocess.run(
                        [self.cli_path, "config", "add", "board_manager.additional_urls", url],
                        capture_output=True, text=True
                    )

            # Refresh index so new cores are discoverable.
            # Timeout to prevent blocking startup on slow GitHub connections.
            print("[arduino-cli] Updating core index...")
            try:
                subprocess.run(
                    [self.cli_path, "core", "update-index"],
                    capture_output=True, text=True, timeout=30
                )
            except subprocess.TimeoutExpired:
                print("[arduino-cli] Core index update timed out (30s), continuing...")
            except Exception as e:
                print(f"[arduino-cli] Core index update failed: {e}, continuing...")
        except Exception as e:
            print(f"Warning: Could not configure board URLs: {e}")

    def _ensure_core_installed(self):
        """
        Ensure essential cores (arduino:avr) are installed at startup.
        Other cores (RP2040, ESP32) are installed on-demand.
        """
        try:
            result = subprocess.run(
                [self.cli_path, "core", "list"],
                capture_output=True,
                text=True
            )

            for core_id in self.REQUIRED_CORES:
                if core_id not in result.stdout:
                    print(f"[arduino-cli] Core {core_id} not installed. Installing...")
                    subprocess.run(
                        [self.cli_path, "core", "install", core_id],
                        check=True
                    )
                    print(f"[arduino-cli] Core {core_id} installed successfully")
        except Exception as e:
            print(f"Warning: Could not verify cores: {e}")
            print("Please ensure arduino-cli is installed and in PATH")

    def _core_id_for_fqbn(self, fqbn: str) -> str | None:
        """Extract the core ID needed for a given FQBN."""
        for prefix, core_id in self.ON_DEMAND_CORES.items():
            if prefix in fqbn:
                return core_id
        return None

    def _is_core_installed(self, core_id: str) -> bool:
        """Check whether a core is currently installed."""
        result = subprocess.run(
            [self.cli_path, "core", "list"],
            capture_output=True, text=True, timeout=CLI_FAST_TIMEOUT_SECONDS
        )
        return core_id in result.stdout

    async def ensure_core_for_board(self, fqbn: str) -> dict:
        """
        Auto-install the core required by a board FQBN if not present.
        Returns status dict with install log.
        """
        core_id = self._core_id_for_fqbn(fqbn)
        if core_id is None:
            # Built-in core (arduino:avr) — should already be there
            return {"needed": False, "installed": True, "core_id": None, "log": ""}

        try:
            if self._is_core_installed(core_id):
                return {"needed": False, "installed": True, "core_id": core_id, "log": ""}
        except subprocess.TimeoutExpired as exc:
            msg = f"arduino-cli core list timed out after {CLI_FAST_TIMEOUT_SECONDS}s"
            log = "\n".join(filter(None, [
                _timeout_output(exc.stdout),
                _timeout_output(exc.stderr),
                msg,
            ]))
            print(f"[arduino-cli] {msg}")
            return {"needed": True, "installed": False, "core_id": core_id, "log": log}

        # Install the core (optionally pinned to a specific version)
        version = self.CORE_INSTALL_VERSIONS.get(core_id)
        install_spec = f"{core_id}@{version}" if version else core_id
        print(f"[arduino-cli] Auto-installing core {install_spec} for board {fqbn}...")

        def _install():
            return subprocess.run(
                [self.cli_path, "core", "install", install_spec],
                capture_output=True, text=True, timeout=CLI_CORE_INSTALL_TIMEOUT_SECONDS
            )

        try:
            result = await asyncio.to_thread(_install)
        except subprocess.TimeoutExpired as exc:
            msg = f"arduino-cli core install timed out after {CLI_CORE_INSTALL_TIMEOUT_SECONDS}s"
            log = "\n".join(filter(None, [
                _timeout_output(exc.stdout),
                _timeout_output(exc.stderr),
                msg,
            ]))
            print(f"[arduino-cli] {msg}")
            return {"needed": True, "installed": False, "core_id": core_id, "log": log}
        log = result.stdout + "\n" + result.stderr

        if result.returncode == 0:
            print(f"[arduino-cli] Core {core_id} installed successfully")
            return {"needed": True, "installed": True, "core_id": core_id, "log": log.strip()}
        else:
            print(f"[arduino-cli] Failed to install core {core_id}: {result.stderr}")
            return {"needed": True, "installed": False, "core_id": core_id, "log": log.strip()}

    async def get_setup_status(self) -> dict:
        """Return the current state of arduino-cli and installed cores."""
        try:
            version_result = subprocess.run(
                [self.cli_path, "version"],
                capture_output=True, text=True
            )
            version = version_result.stdout.strip() if version_result.returncode == 0 else "unknown"

            list_result = subprocess.run(
                [self.cli_path, "core", "list"],
                capture_output=True, text=True
            )
            cores_raw = list_result.stdout.strip()
        except FileNotFoundError:
            return {
                "cli_available": False,
                "version": None,
                "cores": [],
                "error": "arduino-cli not found in PATH"
            }
        except Exception as e:
            return {
                "cli_available": False,
                "version": None,
                "cores": [],
                "error": str(e)
            }

        # Parse installed cores
        cores = []
        for line in cores_raw.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 3:
                cores.append({"id": parts[0], "installed": parts[1], "latest": parts[2]})

        return {
            "cli_available": True,
            "version": version,
            "cores": cores,
            "error": None
        }

    def _is_rp2040_board(self, fqbn: str) -> bool:
        """Return True if the FQBN targets an RP2040/RP2350 board."""
        return any(p in fqbn for p in ("rp2040", "rp2350", "mbed_rp2040", "mbed_rp2350"))

    def _is_esp32_board(self, fqbn: str) -> bool:
        """Return True if the FQBN targets an ESP32 family board."""
        return fqbn.startswith("esp32:")

    def _is_stm32_board(self, fqbn: str) -> bool:
        """Return True if the FQBN targets an STM32 (STM32duino) board.

        STM32 boots from an ELF via QEMU's -kernel (libqemu-arm), so the
        emulator wants the .elf artifact, not a flash image."""
        return fqbn.startswith("STMicroelectronics:stm32")

    def _is_esp32c3_board(self, fqbn: str) -> bool:
        """Return True if the FQBN targets an ESP32-C3 (RISC-V) board.

        ESP32-C3 places the bootloader at flash offset 0x0000, unlike Xtensa
        boards (ESP32, ESP32-S3) which use 0x1000.
        """
        return "esp32c3" in fqbn or "xiao-esp32-c3" in fqbn or "aitewinrobot-esp32c3-supermini" in fqbn

    async def compile(
        self,
        files: list[dict],
        board_fqbn: str = "arduino:avr:uno",
        board_options: dict | None = None,
        allowed_libraries: set[str] | None = None,
        owner_id: str | None = None,
    ) -> dict:
        """
        Compile Arduino sketch using arduino-cli.

        `files` is a list of {"name": str, "content": str} dicts.
        arduino-cli requires the sketch directory to contain a .ino file whose
        name matches the directory ("sketch").  If none exists we promote the
        first .ino file to sketch.ino automatically.

        `board_options` is accepted for API symmetry with the ESP-IDF path
        (ESP32 partition/PSRAM/etc selectors live in the UI). It is currently
        ignored — AVR / RP2040 / ATTiny toolchains don't expose those knobs.
        Reserved for future per-board options on those families.

        `allowed_libraries` is the per-board manifest = library resolution SCOPE
        (P2.1f). When set, ONLY those libraries are made visible to arduino-cli
        (a throwaway scratch sketchbook of symlinks materialized by the pro
        overlay from the content-addressed cache / owner store, pointed at via
        ARDUINO_DIRECTORIES_USER), instead of the shared global volume.
        `owner_id` is the project OWNER's id so a shared / embed compile resolves
        that owner's custom libraries. None/empty manifest (or no overlay) ->
        arduino-cli's default sketchbook -> scan-all (legacy parity).

        Returns:
            dict with keys: success, hex_content, stdout, stderr, error
        """
        _ = board_options  # reserved; see docstring
        print(f"\n=== Starting compilation ===")
        print(f"Board: {board_fqbn}")
        print(f"Files: {[f['name'] for f in files]}")

        stm32_cache_key = None
        if self._is_stm32_board(board_fqbn) and _stm32_compile_cache_enabled():
            stm32_cache_key = _stm32_compile_cache_key(
                files,
                board_fqbn,
                board_options,
                allowed_libraries,
                owner_id,
            )
            cached = _stm32_compile_cache_read(stm32_cache_key)
            if cached:
                raw_bytes = cached["raw"]
                binary_type = cached["binary_type"]
                print(f"[STM32] Compile cache hit: {stm32_cache_key}")
                return {
                    "success": True,
                    "hex_content": None,
                    "binary_content": base64.b64encode(raw_bytes).decode("ascii"),
                    "binary_type": binary_type,
                    "stdout": "STM32 compile cache hit\n",
                    "stderr": "",
                    "cache_hit": True,
                }

        # Create temporary directory for sketch
        with tempfile.TemporaryDirectory() as temp_dir:
            sketch_dir = Path(temp_dir) / "sketch"
            sketch_dir.mkdir()

            # Determine whether the caller already provides a "sketch.ino"
            has_sketch_ino = any(f["name"] == "sketch.ino" for f in files)
            main_ino_written = False

            for file_entry in files:
                name: str = file_entry["name"]
                content: str = file_entry["content"]

                # Promote the first .ino to sketch.ino if none explicitly named so
                write_name = name
                if not has_sketch_ino and name.endswith(".ino") and not main_ino_written:
                    write_name = "sketch.ino"
                    main_ino_written = True

                # RP2040: redirect Serial → Serial1 in the main sketch file only
                if "rp2040" in board_fqbn and write_name == "sketch.ino":
                    content = "#define Serial Serial1\n" + content

                if self._is_stm32_board(board_fqbn) and write_name == "sketch.ino":
                    content = STM32_RENODE_SERIAL_SHIM + content

                if (
                    self._is_stm32_board(board_fqbn)
                    and write_name == "sketch.ino"
                    and "SystemClock_Config" not in content
                ):
                    content = STM32_RENODE_CLOCK_HOOK + content

                (sketch_dir / write_name).write_text(content, encoding="utf-8")

            if self._is_stm32_board(board_fqbn):
                (sketch_dir / "Wire.h").write_text(
                    STM32_RENODE_WIRE_HEADER,
                    encoding="utf-8",
                )
                (sketch_dir / "VelxioRenodeWire.cpp").write_text(
                    STM32_RENODE_WIRE_IMPL,
                    encoding="utf-8",
                )
                (sketch_dir / "SPI.h").write_text(
                    STM32_RENODE_SPI_HEADER,
                    encoding="utf-8",
                )
                (sketch_dir / "VelxioRenodeSPI.cpp").write_text(
                    STM32_RENODE_SPI_IMPL,
                    encoding="utf-8",
                )

            # Fallback: no .ino files provided at all
            if not any(f["name"].endswith(".ino") for f in files):
                (sketch_dir / "sketch.ino").write_text("void setup(){}\nvoid loop(){}", encoding="utf-8")

            print(f"Sketch directory contents: {[p.name for p in sketch_dir.iterdir()]}")

            build_dir = sketch_dir / "build"
            build_dir.mkdir()
            print(f"Build directory: {build_dir}")

            # P2.1f — manifest-scoped library resolution. Symlink ONLY the
            # declared libraries (resolved owner-store -> content-addressed
            # cache -> legacy global dir) into a throwaway scratch sketchbook and
            # point arduino-cli's USER directory at it, so it scans ONLY those
            # libraries instead of the shared mutable global volume. None/empty
            # manifest (or no pro overlay) -> no override -> arduino-cli's default
            # sketchbook -> legacy global scan-all (parity).
            #
            # Mechanism: ARDUINO_DIRECTORIES_USER (the sketchbook), NOT the
            # --libraries flag. Verified empirically that `--libraries` ADDS to
            # the search path (the global sketchbook is STILL scanned, so it does
            # not isolate), whereas pointing ARDUINO_DIRECTORIES_USER at the
            # scratch root makes <scratch>/libraries the ONLY user-library dir.
            # scope_dir == <scratch>/libraries, so its parent is the sketchbook
            # root. Cores + board-manager URLs live in the DATA dir and are
            # untouched, so RP2040 / ATTinyCore / AVR core resolution stays intact.
            scope_dir = None
            try:
                scope = materialize_library_scope(allowed_libraries, owner_id)
                scope_dir = scope[0] if scope else None
                compile_env = dict(os.environ)
                if scope_dir is not None:
                    compile_env["ARDUINO_DIRECTORIES_USER"] = str(scope_dir.parent)
                else:
                    # P2.1h: NO manifest -> point the default sketchbook at the
                    # content-addressed cache (VELXIO_FALLBACK_SKETCHBOOK, whose
                    # libraries/ is the cache root) instead of the shared global
                    # volume, so a from-scratch / no-manifest compile (and the
                    # scan-all retry, which re-enters here unscoped) resolves user
                    # libraries from the cache. Unset (OSS self-host) -> arduino-
                    # cli's default sketchbook (legacy global volume).
                    _fb = os.environ.get("VELXIO_FALLBACK_SKETCHBOOK")
                    if _fb:
                        compile_env["ARDUINO_DIRECTORIES_USER"] = _fb

                # Run compilation using subprocess.run in a thread (Windows compatible)
                # ESP32 lcgamboa emulator requires DIO flash mode and
                # IRAM-safe interrupt placement to avoid cache errors.
                # Force these at compile time for all ESP32 targets.
                cmd = [self.cli_path, "compile", "--fqbn", board_fqbn]
                if self._is_esp32_board(board_fqbn):
                    # FlashMode=dio: required by esp32-picsimlab QEMU machine
                    # IRAM_ATTR on all interrupt handlers prevents cache crashes
                    # when WiFi emulation disables the SPI flash cache on core 1.
                    fqbn_dio = board_fqbn
                    if 'FlashMode' not in board_fqbn:
                        fqbn_dio = board_fqbn + ':FlashMode=dio'
                    cmd[2] = '--fqbn'
                    cmd.insert(3, fqbn_dio)
                    cmd = cmd[:4]  # trim accidental duplicates
                    cmd = [self.cli_path, "compile", "--fqbn", fqbn_dio,
                           "--build-property",
                           "build.extra_flags=-DARDUINO_ESP32_LCGAMBOA=1",
                           # Adafruit_BusIO 1.17.x dropped BitOrder on ESP32 3.x;
                           # this define restores it as uint8_t (the type it was).
                           "--build-property",
                           "compiler.cpp.extra_flags=-DBitOrder=uint8_t",
                           "--output-dir", str(build_dir),
                           str(sketch_dir)]
                else:
                    cmd = [self.cli_path, "compile", "--fqbn", board_fqbn,
                           "--output-dir", str(build_dir),
                           str(sketch_dir)]
                print(f"Running command: {' '.join(cmd)}")

                # Use subprocess.run in a thread for Windows compatibility
                def run_compile():
                    return subprocess.run(
                        cmd,
                        capture_output=True,
                        text=True,
                        env=compile_env,
                        timeout=CLI_COMPILE_TIMEOUT_SECONDS,
                    )

                try:
                    result = await asyncio.to_thread(run_compile)
                except subprocess.TimeoutExpired as exc:
                    msg = f"arduino-cli compile timed out after {CLI_COMPILE_TIMEOUT_SECONDS}s"
                    stdout = _timeout_output(exc.stdout)
                    stderr = "\n".join(filter(None, [_timeout_output(exc.stderr), msg]))
                    print(f"=== Compilation timed out: {msg} ===\n")
                    return {
                        "success": False,
                        "error": msg,
                        "stdout": stdout,
                        "stderr": stderr,
                    }

                print(f"Process return code: {result.returncode}")
                print(f"Stdout: {result.stdout}")
                print(f"Stderr: {result.stderr}")

                if result.returncode == 0:
                    print(f"Files in build dir: {list(build_dir.iterdir())}")

                    if self._is_rp2040_board(board_fqbn):
                        # RP2040 outputs a .bin file (and optionally .uf2)
                        # Try .bin first (raw binary, simplest to load into emulator)
                        bin_file = build_dir / "sketch.ino.bin"
                        uf2_file = build_dir / "sketch.ino.uf2"

                        target_file = bin_file if bin_file.exists() else (uf2_file if uf2_file.exists() else None)

                        if target_file:
                            raw_bytes = target_file.read_bytes()
                            binary_b64 = base64.b64encode(raw_bytes).decode('ascii')
                            print(f"[RP2040] Binary file: {target_file.name}, size: {len(raw_bytes)} bytes")
                            print("=== RP2040 Compilation successful ===\n")
                            return {
                                "success": True,
                                "hex_content": None,
                                "binary_content": binary_b64,
                                "binary_type": "bin" if target_file == bin_file else "uf2",
                                "stdout": result.stdout,
                                "stderr": result.stderr
                            }
                        else:
                            print(f"[RP2040] Binary file not found. Files: {list(build_dir.iterdir())}")
                            print("=== RP2040 Compilation failed: binary not found ===\n")
                            return {
                                "success": False,
                                "error": "RP2040 binary (.bin/.uf2) not found after compilation",
                                "stdout": result.stdout,
                                "stderr": result.stderr
                            }
                    elif self._is_esp32_board(board_fqbn):
                        # ESP32 outputs individual .bin files that must be merged into a
                        # single 4MB flash image for QEMU lcgamboa to boot correctly.
                        bin_file        = build_dir / "sketch.ino.bin"
                        bootloader_file = build_dir / "sketch.ino.bootloader.bin"
                        partitions_file = build_dir / "sketch.ino.partitions.bin"
                        merged_file     = build_dir / "sketch.ino.merged.bin"

                        print(f"[ESP32] Build dir contents: {[f.name for f in build_dir.iterdir()]}")

                        # Merge individual .bin files into a single 4MB flash image in pure Python.
                        # Flash layout differs by chip:
                        #   ESP32 / ESP32-S3 (Xtensa): 0x1000 bootloader | 0x8000 partitions | 0x10000 app
                        #   ESP32-C3 (RISC-V):         0x0000 bootloader | 0x8000 partitions | 0x10000 app
                        # QEMU lcgamboa requires exactly 2/4/8/16 MB flash — raw app binary won't boot.
                        if not merged_file.exists() and bin_file.exists() and bootloader_file.exists() and partitions_file.exists():
                            print("[ESP32] Merging binaries into 4MB flash image (pure Python)...")
                            try:
                                FLASH_SIZE = 4 * 1024 * 1024  # 4 MB
                                flash = bytearray(b'\xff' * FLASH_SIZE)
                                bootloader_offset = 0x0000 if self._is_esp32c3_board(board_fqbn) else 0x1000
                                for offset, path in [
                                    (bootloader_offset, bootloader_file),
                                    (0x8000,            partitions_file),
                                    (0x10000,           bin_file),
                                ]:
                                    data = path.read_bytes()
                                    flash[offset:offset + len(data)] = data
                                merged_file.write_bytes(bytes(flash))
                                print(f"[ESP32] Merged image: {merged_file.stat().st_size} bytes (bootloader @ 0x{bootloader_offset:04X})")
                            except Exception as e:
                                print(f"[ESP32] Merge failed: {e} — falling back to raw app binary")

                        target_file = merged_file if merged_file.exists() else (bin_file if bin_file.exists() else None)

                        if target_file:
                            raw_bytes = target_file.read_bytes()
                            binary_b64 = base64.b64encode(raw_bytes).decode('ascii')
                            print(f"[ESP32] Binary file: {target_file.name}, size: {len(raw_bytes)} bytes")
                            print("=== ESP32 Compilation successful ===\n")
                            return {
                                "success": True,
                                "hex_content": None,
                                "binary_content": binary_b64,
                                "binary_type": "bin",
                                "stdout": result.stdout,
                                "stderr": result.stderr
                            }
                        else:
                            print(f"[ESP32] Binary file not found. Files: {list(build_dir.iterdir())}")
                            print("=== ESP32 Compilation failed: binary not found ===\n")
                            return {
                                "success": False,
                                "error": "ESP32 binary (.bin) not found after compilation",
                                "stdout": result.stdout,
                                "stderr": result.stderr
                            }
                    elif self._is_stm32_board(board_fqbn):
                        # STM32 (STM32duino) boots from an ELF via QEMU -kernel.
                        elf_file = build_dir / "sketch.ino.elf"
                        bin_file = build_dir / "sketch.ino.bin"
                        target_file = elf_file if elf_file.exists() else (bin_file if bin_file.exists() else None)
                        if target_file:
                            raw_bytes = target_file.read_bytes()
                            binary_type = "elf" if target_file == elf_file else "bin"
                            if stm32_cache_key is not None:
                                _stm32_compile_cache_write(stm32_cache_key, raw_bytes, binary_type)
                            binary_b64 = base64.b64encode(raw_bytes).decode('ascii')
                            print(f"[STM32] Binary file: {target_file.name}, size: {len(raw_bytes)} bytes")
                            print("=== STM32 Compilation successful ===\n")
                            return {
                                "success": True,
                                "hex_content": None,
                                "binary_content": binary_b64,
                                "binary_type": binary_type,
                                "stdout": result.stdout,
                                "stderr": result.stderr,
                            }
                        else:
                            print(f"[STM32] ELF/bin not found. Files: {list(build_dir.iterdir())}")
                            return {
                                "success": False,
                                "error": "STM32 firmware (.elf/.bin) not found after compilation",
                                "stdout": result.stdout,
                                "stderr": result.stderr,
                            }
                    else:
                        # AVR outputs a .hex file (Intel HEX format)
                        hex_file = build_dir / "sketch.ino.hex"
                        print(f"Looking for hex file at: {hex_file}")
                        print(f"Hex file exists: {hex_file.exists()}")

                        if hex_file.exists():
                            hex_content = hex_file.read_text()
                            print(f"Hex file size: {len(hex_content)} bytes")
                            print("=== AVR Compilation successful ===\n")
                            return {
                                "success": True,
                                "hex_content": hex_content,
                                "binary_content": None,
                                "stdout": result.stdout,
                                "stderr": result.stderr
                            }
                        else:
                            print(f"Files in build dir: {list(build_dir.iterdir())}")
                            print("=== Compilation failed: hex file not found ===\n")
                            return {
                                "success": False,
                                "error": "Hex file not found after compilation",
                                "stdout": result.stdout,
                                "stderr": result.stderr
                            }
                else:
                    print("=== Compilation failed ===\n")
                    # P2.1f graceful fallback (mirrors the ESP-IDF path): a
                    # manifest-scoped compile points ARDUINO_DIRECTORIES_USER at
                    # a sketchbook holding ONLY the declared libraries, so the
                    # global volume is not scanned. If the manifest omitted a
                    # needed library or a transitive dependency, a header goes
                    # missing and the build hard-fails where the legacy global
                    # scan-all would have found it. So when a scope was applied
                    # and the failure is a missing #include, retry ONCE without
                    # the scope (global scan-all) and flag the manifest as
                    # incomplete. A genuine source error fails both attempts and
                    # returns the original scoped failure below.
                    if scope_dir is not None and _looks_like_missing_header(result.stderr):
                        print("=== Incomplete manifest — retrying scan-all ===\n")
                        retry = await self.compile(
                            files, board_fqbn, board_options=board_options,
                        )  # allowed_libraries=None -> no scope -> no further retry
                        if retry.get("success"):
                            retry["manifest_incomplete"] = True
                            return retry
                    return {
                        "success": False,
                        "error": "Compilation failed",
                        "stdout": result.stdout,
                        "stderr": result.stderr
                    }

            except Exception as e:
                print(f"=== Exception during compilation: {e} ===\n")
                import traceback
                traceback.print_exc()
                return {
                    "success": False,
                    "error": str(e),
                    "stdout": "",
                    "stderr": ""
                }
            finally:
                if scope_dir is not None:
                    # rmtree unlinks the symlinks, never their cache / store /
                    # legacy targets.
                    shutil.rmtree(scope_dir.parent, ignore_errors=True)

    async def list_boards(self) -> list:
        """
        List available Arduino boards
        """
        try:
            process = await asyncio.create_subprocess_exec(
                self.cli_path,
                "board",
                "listall",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            stdout, _ = await process.communicate()

            # Parse output (format: "Board Name    FQBN")
            boards = []
            for line in stdout.decode().splitlines()[1:]:  # Skip header
                if line.strip():
                    parts = line.split()
                    if len(parts) >= 2:
                        name = " ".join(parts[:-1])
                        fqbn = parts[-1]
                        boards.append({"name": name, "fqbn": fqbn})

            return boards

        except Exception as e:
            print(f"Error listing boards: {e}")
            return []

    async def search_libraries(self, query: str) -> dict:
        """
        Search for Arduino libraries
        """
        try:
            def _run():
                return subprocess.run(
                    [self.cli_path, "lib", "search", query, "--format", "json"],
                    capture_output=True, text=True, encoding='utf-8', errors='replace'
                )

            result = await asyncio.to_thread(_run)
            stdout, stderr = result.stdout, result.stderr

            if result.returncode != 0:
                print(f"Error searching libraries: {stderr}")
                return {"success": False, "error": stderr}
                
            import json
            try:
                results = json.loads(stdout)
                libraries = results.get("libraries", [])

                # arduino-cli search returns each lib with a "releases" dict.
                # Inject a "latest" key with the data of the highest version so the
                # frontend can access lib.latest.version / author / sentence directly.
                def _parse_version(v: str):
                    try:
                        parts = v.split(".")
                        # Reject if any part is not a digit (filters out "1_2_3", "beta", "latest")
                        if any(not p.isdigit() for p in parts):
                            return (0,)
                        return tuple(int(p) for p in parts)
                    except Exception:
                        return (0,)

                for lib in libraries:
                    releases = lib.get("releases") or {}
                    if releases:
                        latest_key = max(releases.keys(), key=_parse_version)
                        lib["latest"] = {**releases[latest_key], "version": latest_key}

                return {"success": True, "libraries": libraries}
            except json.JSONDecodeError:
                return {"success": False, "error": "Invalid output format from arduino-cli"}

        except Exception as e:
            print(f"Exception searching libraries: {e}")
            return {"success": False, "error": str(e)}

    async def install_library(self, library_name: str) -> dict:
        """
        Install an Arduino library.
        Handles standard library names as well as Wokwi-hosted entries in
        the form  "LibName@wokwi:projectHash".
        Also handles versioned installs via "LibName@version" syntax
        (e.g. "Adafruit NeoPixel@1.11.0").

        @latest is stripped — arduino-cli does not support it.
        Malformed version strings (non-semver) fall back to plain name install.
        """
        if '@wokwi:' in library_name:
            return await self._install_wokwi_library(library_name)

        # Strip @latest — arduino-cli does not support this token
        if library_name.endswith('@latest'):
            library_name = library_name[:-7]

        try:
            print(f"Installing library: {library_name}")

            # Handle "Name@version" syntax for versioned installs
            # Only quote if the version part is valid semver (major.minor.patch)
            import re
            lib_spec = library_name
            if '@' in library_name:
                parts = library_name.rsplit('@', 1)
                if len(parts) == 2 and parts[1]:
                    version = parts[1]
                    # Validate semver: major.minor.patch (all numeric)
                    if re.fullmatch(r'\d+\.\d+\.\d+', version):
                        lib_spec = library_name  # no quotes needed — subprocess passes args literally
                    else:
                        # Bad/empty version — fall back to plain name
                        library_name = parts[0]
                        lib_spec = library_name

            def _run():
                return subprocess.run(
                    [self.cli_path, "lib", "install", lib_spec],
                    capture_output=True, text=True, encoding='utf-8', errors='replace'
                )

            result = await asyncio.to_thread(_run)

            if result.returncode == 0:
                print(f"Successfully installed {library_name}")
                return {"success": True, "stdout": result.stdout}
            else:
                # If a specific version failed, retry with plain name (latest) in case
                # the version string is valid semver but rejected by arduino-cli for
                # other reasons (e.g. leading zeros, lib index corruption).
                if '@' in library_name:
                    plain_name = library_name.rsplit('@', 1)[0]
                    version = library_name.rsplit('@', 1)[1]
                    print(f"Versioned install failed, retrying with plain name: {plain_name}")
                    def _run_plain():
                        return subprocess.run(
                            [self.cli_path, "lib", "install", plain_name],
                            capture_output=True, text=True, encoding='utf-8', errors='replace'
                        )
                    result = await asyncio.to_thread(_run_plain)
                    if result.returncode == 0:
                        print(f"Successfully installed {plain_name} (fallback to latest)")
                        return {
                            "success": True,
                            "stdout": result.stdout,
                            "fallback": True,
                            "requested_version": version,
                        }
                print(f"Failed to install {library_name}: {result.stderr}")
                return {"success": False, "error": result.stderr, "stdout": result.stdout}

        except Exception as e:
            print(f"Exception installing library: {e}")
            return {"success": False, "error": str(e)}

    async def _install_wokwi_library(self, library_spec: str) -> dict:
        """
        Download and install a Wokwi-hosted library.

        Wokwi stores custom libraries as projects.  The spec format is:
            LibName@wokwi:projectHash
        and the project ZIP is available at:
            https://wokwi.com/api/projects/{projectHash}/zip

        The ZIP is extracted into the Arduino user libraries directory so that
        arduino-cli can find the headers during compilation.
        """
        import json as _json
        import urllib.request
        import urllib.error
        import zipfile
        import os
        import shutil

        parts = library_spec.split('@wokwi:', 1)
        lib_name = parts[0].strip()
        project_hash = parts[1].strip()
        print(f"Installing Wokwi library: {lib_name} (project: {project_hash})")

        # ── Locate the Arduino user libraries directory ────────────────────────
        try:
            def _get_config():
                return subprocess.run(
                    [self.cli_path, "config", "dump", "--format", "json"],
                    capture_output=True, text=True, encoding='utf-8', errors='replace'
                )
            cfg_result = await asyncio.to_thread(_get_config)
            cfg = _json.loads(cfg_result.stdout)
            config_dict = cfg.get("config", cfg)
            dirs = config_dict.get("directories", {})
            user_dir = dirs.get("user", "") or dirs.get("sketchbook", "")
            if not user_dir:
                return {"success": False, "error": "Could not determine Arduino user directory from config"}
            lib_dir = Path(user_dir) / "libraries" / lib_name
        except Exception as e:
            return {"success": False, "error": f"Failed to read arduino-cli config: {e}"}

        # ── Download project ZIP ───────────────────────────────────────────────
        url = f"https://wokwi.com/api/projects/{project_hash}/zip"
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp:
                tmp_path = tmp.name

            def _download():
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "velxio-arduino-emulator/1.0"},
                )
                try:
                    with urllib.request.urlopen(req, timeout=30) as resp, \
                         open(tmp_path, 'wb') as out:
                        out.write(resp.read())
                except urllib.error.HTTPError as http_err:
                    raise RuntimeError(
                        f"Could not download Wokwi library '{lib_name}' "
                        f"(HTTP {http_err.code}). "
                        f"Wokwi-hosted libraries require the Wokwi platform and "
                        f"cannot be installed automatically in a local environment."
                    ) from http_err

            await asyncio.to_thread(_download)

            # ── Extract into the libraries directory ───────────────────────────
            if lib_dir.exists():
                shutil.rmtree(lib_dir)
            lib_dir.mkdir(parents=True, exist_ok=True)

            with zipfile.ZipFile(tmp_path, 'r') as zf:
                for zi in zf.infolist():
                    # Skip directories and Wokwi-specific files
                    if zi.is_dir():
                        continue
                    fname = zi.filename
                    basename = Path(fname).name
                    if not basename or basename == 'wokwi-project.txt':
                        continue
                    # Flatten any subdirectory structure
                    dest = lib_dir / basename
                    dest.write_bytes(zf.read(fname))

            # Create a minimal library.properties so arduino-cli recognises it
            props = lib_dir / "library.properties"
            if not props.exists():
                props.write_text(
                    f"name={lib_name}\nversion=1.0.0\nauthor=Wokwi\n"
                    f"sentence=Wokwi-hosted library\nparagraph=\ncategory=Other\n"
                    f"url=https://wokwi.com/projects/{project_hash}\n"
                    f"architectures=*\n"
                )

            print(f"Installed Wokwi library {lib_name} to {lib_dir}")
            return {"success": True, "stdout": f"Installed {lib_name} from Wokwi project {project_hash}"}

        except Exception as e:
            print(f"Error installing Wokwi library {lib_name}: {e}")
            return {"success": False, "error": str(e)}
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    async def list_installed_libraries(self) -> dict:
        """
        List all installed Arduino libraries.

        P2.1h: when VELXIO_FALLBACK_SKETCHBOOK is set (pro overlay), list the
        content-addressed cache (its libraries/ is the cache root) instead of the
        shared global volume, so the Library Manager 'Installed' view survives the
        global volume's retirement. Unset (OSS) -> arduino-cli's default sketchbook.
        """
        try:
            list_env = dict(os.environ)
            _fb = os.environ.get("VELXIO_FALLBACK_SKETCHBOOK")
            if _fb:
                list_env["ARDUINO_DIRECTORIES_USER"] = _fb

            def _run():
                return subprocess.run(
                    [self.cli_path, "lib", "list", "--format", "json"],
                    capture_output=True, text=True, encoding='utf-8', errors='replace',
                    env=list_env,
                )

            result = await asyncio.to_thread(_run)
            stdout, stderr = result.stdout, result.stderr

            if result.returncode != 0:
                print(f"Error listing libraries: {stderr}")
                return {"success": False, "error": stderr}
                
            import json
            try:
                if not stdout.strip():
                    return {"success": True, "libraries": []}

                results = json.loads(stdout)

                # arduino-cli lib list --format json wraps results in "installed_libraries"
                if isinstance(results, list):
                    libraries = results
                elif isinstance(results, dict):
                    libraries = (
                        results.get("installed_libraries")
                        or results.get("libraries")
                        or []
                    )
                else:
                    libraries = []

                return {"success": True, "libraries": libraries}

            except json.JSONDecodeError:
                return {"success": False, "error": "Invalid output format from arduino-cli"}

        except Exception as e:
            print(f"Exception listing libraries: {e}")
            return {"success": False, "error": str(e)}

    async def uninstall_library(self, library_name: str) -> dict:
        """
        Uninstall an Arduino library.
        """
        try:
            print(f"Uninstalling library: {library_name}")

            def _run():
                return subprocess.run(
                    [self.cli_path, "lib", "uninstall", library_name],
                    capture_output=True, text=True, encoding='utf-8', errors='replace'
                )

            result = await asyncio.to_thread(_run)

            if result.returncode == 0:
                print(f"Successfully uninstalled {library_name}")
                return {"success": True, "stdout": result.stdout}
            else:
                print(f"Failed to uninstall {library_name}: {result.stderr}")
                return {"success": False, "error": result.stderr, "stdout": result.stdout}

        except Exception as e:
            print(f"Exception uninstalling library: {e}")
            return {"success": False, "error": str(e)}
