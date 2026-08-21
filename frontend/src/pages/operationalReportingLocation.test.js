import assert from "node:assert/strict";
import test from "node:test";

import {
  allocationsKeptAfterBlockRelocation,
  defaultAllocationLocation,
  relocationLabel,
  sameLocation,
} from "./operationalReportingLocation.js";

const block = {
  actual_area_id: "area-a",
  actual_building: "A1",
  allocations: [
    { start_offset_minutes: 0, minutes: 120, actual_area_id: "area-a", actual_building: "A1" },
    { start_offset_minutes: 120, minutes: 120, actual_area_id: "area-b", actual_building: "B2", actual_area_name: "Area B" },
  ],
};

test("il box che segue il blocco non mostra la destinazione", () => {
  assert.equal(relocationLabel(block, block.allocations[0]), "");
});

test("il box spostato mostra area e immobile", () => {
  assert.equal(relocationLabel(block, block.allocations[1]), "📍 Area B / B2");
});

test("un immobile diverso nella stessa area è già uno spostamento", () => {
  const allocation = { actual_area_id: "area-a", actual_building: "A2", actual_area_name: "Area A" };
  assert.equal(sameLocation(block, allocation), false);
  assert.equal(relocationLabel(block, allocation), "📍 Area A / A2");
});

test("il box nuovo eredita la destinazione di quello che lo precede", () => {
  assert.deepEqual(defaultAllocationLocation(block, 240), { actual_area_id: "area-b", actual_building: "B2" });
  assert.deepEqual(defaultAllocationLocation(block, 60), { actual_area_id: "area-a", actual_building: "A1" });
});

test("senza box precedenti vale la destinazione del blocco", () => {
  assert.deepEqual(
    defaultAllocationLocation({ ...block, allocations: [] }, 0),
    { actual_area_id: "area-a", actual_building: "A1" },
  );
});

test("cambiando area al blocco restano solo i box spostati altrove", () => {
  const kept = allocationsKeptAfterBlockRelocation(block);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].actual_area_id, "area-b");
});
