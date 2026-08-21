import test from "node:test";
import assert from "node:assert/strict";

import {
  fillPastedBlocks,
  flattenAllocations,
  scheduleDifferences,
  scheduleDigest,
} from "./operationalReportingPaste.js";

function allocation(code, minutes, offset, overrides = {}) {
  return {
    customer_code: code,
    customer_description: `Cliente ${code}`,
    jupiter_description: "Attività Jupiter",
    minutes,
    start_offset_minutes: offset,
    ...overrides,
  };
}

const sourceBlocks = [
  {
    actual_area_id: "area-a",
    actual_building: "A1",
    allocations: [
      allocation("CLI-2", 120, 120),
      allocation("CLI-1", 120, 0),
    ],
  },
];

test("le attività dell'origine escono in ordine di orologio", () => {
  const queue = flattenAllocations(sourceBlocks);
  assert.deepEqual(queue.map((item) => item.customer_code), ["CLI-1", "CLI-2"]);
});

test("ogni attività eredita la destinazione effettiva del blocco di origine", () => {
  const queue = flattenAllocations([
    {
      actual_area_id: "area-a",
      actual_building: "A1",
      allocations: [
        allocation("CLI-1", 60, 0),
        allocation("CLI-2", 60, 60, { actual_area_id: "area-b", actual_building: "B2" }),
      ],
    },
  ]);
  assert.deepEqual(
    queue.map((item) => [item.actual_area_id, item.actual_building]),
    [["area-a", "A1"], ["area-b", "B2"]],
  );
});

test("con la stessa capienza la copia è uno a uno", () => {
  const { blocks, leftover } = fillPastedBlocks(
    [{ capacity_minutes: 240 }],
    flattenAllocations(sourceBlocks),
  );
  assert.equal(leftover, 0);
  assert.deepEqual(
    blocks[0].allocations.map((item) => [item.customer_code, item.minutes, item.start_offset_minutes]),
    [["CLI-1", 120, 0], ["CLI-2", 120, 120]],
  );
});

test("un'attività che non entra in un blocco prosegue nel successivo", () => {
  const { blocks, leftover } = fillPastedBlocks(
    [{ capacity_minutes: 180 }, { capacity_minutes: 60 }],
    flattenAllocations(sourceBlocks),
  );
  assert.equal(leftover, 0);
  assert.deepEqual(
    blocks[0].allocations.map((item) => [item.customer_code, item.minutes]),
    [["CLI-1", 120], ["CLI-2", 60]],
  );
  assert.deepEqual(
    blocks[1].allocations.map((item) => [item.customer_code, item.minutes, item.start_offset_minutes]),
    [["CLI-2", 60, 0]],
  );
});

test("quello che non ci sta resta fuori ed è dichiarato", () => {
  const { blocks, leftover } = fillPastedBlocks(
    [{ capacity_minutes: 150 }],
    flattenAllocations(sourceBlocks),
  );
  assert.equal(leftover, 90);
  assert.deepEqual(
    blocks[0].allocations.map((item) => [item.customer_code, item.minutes]),
    [["CLI-1", 120], ["CLI-2", 30]],
  );
});

test("la capienza non multipla di dieci minuti non produce quantità non valide", () => {
  const { blocks, leftover } = fillPastedBlocks(
    [{ capacity_minutes: 125 }],
    flattenAllocations([{ actual_area_id: "area-a", allocations: [allocation("CLI-1", 240, 0)] }]),
  );
  assert.equal(blocks[0].allocations[0].minutes, 120);
  assert.equal(leftover, 120);
  for (const item of blocks[0].allocations) {
    assert.equal(item.minutes % 10, 0);
    assert.equal(item.start_offset_minutes % 10, 0);
  }
});

test("una destinazione senza capienza lascia fuori tutto", () => {
  const { blocks, leftover } = fillPastedBlocks([{ capacity_minutes: 0 }], flattenAllocations(sourceBlocks));
  assert.deepEqual(blocks[0].allocations, []);
  assert.equal(leftover, 240);
});

function draft(start, end, pauses) {
  return { actual_start: start, actual_end: end, pauses };
}

const eightHourBlocks = [{ capacity_minutes: 480 }];

test("giornate sovrapponibili non producono avvisi", () => {
  const source = scheduleDigest(draft("08:00", "17:00", [{ start: "12:00", end: "13:00" }]), eightHourBlocks);
  const target = scheduleDigest(draft("08:00", "17:00", [{ start: "12:00", end: "13:00" }]), eightHourBlocks);
  assert.deepEqual(scheduleDifferences(source, target), []);
});

test("stesso totale netto ma orario diverso resta una differenza", () => {
  const source = scheduleDigest(draft("06:00", "15:00", [{ start: "12:00", end: "13:00" }]), eightHourBlocks);
  const target = scheduleDigest(draft("09:00", "18:00", [{ start: "12:00", end: "13:00" }]), eightHourBlocks);
  assert.deepEqual(scheduleDifferences(source, target), ["schedule"]);
});

test("stesso orario ma pause diverse resta una differenza", () => {
  const source = scheduleDigest(draft("08:00", "17:00", [{ start: "12:00", end: "13:00" }]), eightHourBlocks);
  const target = scheduleDigest(draft("08:00", "17:00", [{ start: "13:00", end: "14:00" }]), eightHourBlocks);
  assert.deepEqual(scheduleDifferences(source, target), ["pauses"]);
});

test("blocchi pianificati diversi vengono segnalati anche a parità di giornata", () => {
  const day = draft("08:00", "17:00", [{ start: "12:00", end: "13:00" }]);
  const source = scheduleDigest(day, [{ capacity_minutes: 480 }]);
  const target = scheduleDigest(day, [{ capacity_minutes: 240 }, { capacity_minutes: 240 }]);
  assert.deepEqual(scheduleDifferences(source, target), ["blocks"]);
});
