import { describe, it, expect } from 'vitest';

import { exampleProjects } from '../data/examples';
import { BOARD_KIND_FQBN, isStm32BoardKind } from '../types/board';
import { boardPinToNumber, isBoardComponent } from '../utils/boardPinMapping';

describe('STM32 ADC gallery examples', () => {
  it('ships a runnable Blue Pill potentiometer ADC example', () => {
    const example = exampleProjects.find((e) => e.id === 'stm32-bluepill-potentiometer');

    expect(example).toBeDefined();
    expect(example?.boardFilter).toBe('stm32-bluepill');
    expect(example?.boards?.[0]?.boardKind).toBe('stm32-bluepill');
    expect(example?.boards?.[0]?.code).toContain('analogRead(POT_PIN)');
    expect(example?.components.some((c) => c.type === 'wokwi-potentiometer')).toBe(true);
    expect(example?.components.find((c) => c.id === 'pot1')?.properties.value).toBe(512);
    expect(example?.wires).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          start: { componentId: 'stm32-bluepill', pinName: 'PA0' },
          end: { componentId: 'pot1', pinName: 'SIG' },
        }),
        expect.objectContaining({
          start: { componentId: 'stm32-bluepill', pinName: '3V3' },
          end: { componentId: 'pot1', pinName: 'VCC' },
        }),
        expect.objectContaining({
          start: { componentId: 'stm32-bluepill', pinName: 'GND' },
          end: { componentId: 'pot1', pinName: 'GND' },
        }),
      ]),
    );
  });

  it('ships a runnable Blue Pill SPI loopback example', () => {
    const example = exampleProjects.find((e) => e.id === 'stm32-bluepill-spi-loopback');

    expect(example).toBeDefined();
    expect(example?.boardFilter).toBe('stm32-bluepill');
    expect(example?.boards?.[0]?.boardKind).toBe('stm32-bluepill');
    expect(example?.boards?.[0]?.code).toContain('#include <SPI.h>');
    expect(example?.boards?.[0]?.code).toContain('SPI.transfer');
    expect(example?.boards?.[0]?.code).toContain('loopback OK');
  });

  it('ships a Blue Pill SPI OLED example wired to a real display component', () => {
    const example = exampleProjects.find((e) => e.id === 'stm32-bluepill-spi-oled');

    expect(example).toBeDefined();
    expect(example?.boardFilter).toBe('stm32-bluepill');
    expect(example?.boards?.[0]?.boardKind).toBe('stm32-bluepill');
    expect(example?.boards?.[0]?.code).toContain('#include <SPI.h>');
    expect(example?.boards?.[0]?.code).toContain('oledData');
    expect(example?.boards?.[0]?.code).toContain('SPI OLED ready');
    expect(example?.components).toContainEqual(
      expect.objectContaining({
        type: 'wokwi-ssd1306',
        id: 'spioled1',
        properties: expect.objectContaining({ protocol: 'spi' }),
      }),
    );
    expect(example?.wires).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          start: { componentId: 'stm32-bluepill', pinName: 'PB13' },
          end: { componentId: 'spioled1', pinName: 'CLK' },
        }),
        expect.objectContaining({
          start: { componentId: 'stm32-bluepill', pinName: 'PB15' },
          end: { componentId: 'spioled1', pinName: 'DATA' },
        }),
        expect.objectContaining({
          start: { componentId: 'stm32-bluepill', pinName: 'PA8' },
          end: { componentId: 'spioled1', pinName: 'DC' },
        }),
      ]),
    );
  });

  it('covers the STM32 gallery with runnable board metadata and resolvable wires', () => {
    const stm32Examples = exampleProjects.filter((example) => example.id.startsWith('stm32-'));

    expect(stm32Examples.map((example) => example.id).sort()).toEqual([
      'stm32-blackpill-blink',
      'stm32-blackpill-f401-blink',
      'stm32-blackpill-oled',
      'stm32-bluepill-7segment',
      'stm32-bluepill-blackpill-gpio',
      'stm32-bluepill-blink',
      'stm32-bluepill-bmp280',
      'stm32-bluepill-button',
      'stm32-bluepill-f103cb-blink',
      'stm32-bluepill-mpu6050',
      'stm32-bluepill-oled',
      'stm32-bluepill-potentiometer',
      'stm32-bluepill-pwm-led',
      'stm32-bluepill-rgb',
      'stm32-bluepill-rtc',
      'stm32-bluepill-serial-counter',
      'stm32-bluepill-spi-loopback',
      'stm32-bluepill-spi-oled',
      'stm32-bluepill-stepper',
      'stm32-bluepill-switch',
      'stm32-bluepill-weather-station',
      'stm32-esp32-gpio-sync',
      'stm32-f4-discovery-blink',
      'stm32-netduino-plus2-blink',
      'stm32-netduino2-serial',
      'stm32-olimex-h405-blink',
      'stm32-uno-gpio-mirror',
      'stm32-uno-serial-link',
    ]);

    const capabilityNeedles = {
      gpio: (code: string, tags: string[]) => code.includes('digitalWrite') && tags.includes('gpio'),
      input: (code: string, tags: string[]) => code.includes('digitalRead') && tags.includes('input'),
      pwm: (code: string, tags: string[]) => code.includes('analogWrite'),
      adc: (code: string, tags: string[]) => code.includes('analogRead'),
      serial: (code: string, tags: string[]) => code.includes('Serial.'),
      spi: (code: string, tags: string[]) => code.includes('SPI.transfer') && tags.includes('spi'),
      i2cSensor: (code: string, tags: string[]) => code.includes('#include <Wire.h>') && tags.includes('sensor'),
      i2cDisplay: (code: string, tags: string[]) => code.includes('#include <Wire.h>') && tags.includes('display'),
      multiBoard: (_code: string, tags: string[]) => tags.includes('multi-board'),
      motor: (_code: string, tags: string[]) => tags.includes('motor'),
    } satisfies Record<string, (code: string, tags: string[]) => boolean>;

    for (const [capability, predicate] of Object.entries(capabilityNeedles)) {
      expect(
        stm32Examples.some((example) => {
          const code = example.boards.map((board) => board.code).join('\n');
          return predicate(code, example.tags);
        }),
        `missing STM32 ${capability} example`,
      ).toBe(true);
    }

    for (const example of stm32Examples) {
      expect(example.boardFilter, example.id).toBeTruthy();
      expect(example.boards.length, example.id).toBeGreaterThan(0);
      expect(example.boards.some((board) => isStm32BoardKind(board.boardKind)), example.id).toBe(true);

      for (const board of example.boards) {
        expect(board.code.trim(), `${example.id}:${board.boardKind}`).not.toBe('');
        expect(BOARD_KIND_FQBN[board.boardKind], `${example.id}:${board.boardKind}`).toBeTruthy();
      }

      const boardKinds = new Map(example.boards.map((board) => [board.boardKind, board.boardKind]));
      for (const wire of example.wires) {
        for (const endpoint of [wire.start, wire.end]) {
          if (!isBoardComponent(endpoint.componentId)) continue;
          const boardKind =
            example.boards.find((board) => board.id === endpoint.componentId)?.boardKind ??
            example.boards.find((board) => board.boardKind === endpoint.componentId)?.boardKind ??
            boardKinds.get(endpoint.componentId);
          expect(boardKind, `${example.id}:${wire.id}:${endpoint.componentId}`).toBeTruthy();
          expect(
            boardPinToNumber(boardKind!, endpoint.pinName),
            `${example.id}:${wire.id}:${endpoint.componentId}.${endpoint.pinName}`,
          ).not.toBeNull();
        }
      }
    }
  });

  it('uses a visible active-high external LED for the Blue Pill switch example', () => {
    const example = exampleProjects.find((e) => e.id === 'stm32-bluepill-switch');

    expect(example).toBeDefined();
    expect(example?.boards[0].code).toContain('const int LED = PA1;');
    expect(example?.boards[0].code).toContain('digitalWrite(LED, on ? HIGH : LOW);');
    expect(example?.wires).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          start: { componentId: 'stm32-bluepill', pinName: 'PA1' },
          end: { componentId: 'r1', pinName: '1' },
        }),
      ]),
    );
  });
});
