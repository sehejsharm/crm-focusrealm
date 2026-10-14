import assert from "node:assert/strict";
import { test } from "node:test";
import { planAllocation } from "../services/allocation.js";

const prospects = (n: number, segments = ["A", "B", "C"]) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, segment: segments[i % segments.length] }));

test("proposal §4.3: 30 prospects, 3 people with room for 10 each → 10 each", () => {
  const plan = planAllocation({
    prospects: prospects(30),
    people: [{ id: "a", currentActive: 0 }, { id: "b", currentActive: 0 }, { id: "c", currentActive: 0 }],
    batchSize: 10,
    maxActive: 10,
  });
  assert.equal(plan.assignments.length, 30);
  for (const id of ["a", "b", "c"]) assert.equal(plan.perUser[id].assigned, 10);
  assert.equal(plan.unassigned.length, 0);
});

test("proposal §4.3: someone with capacity for 4 gets no more than 4; the rest go to others", () => {
  const plan = planAllocation({
    prospects: prospects(30),
    people: [{ id: "a", currentActive: 0 }, { id: "b", currentActive: 6 }, { id: "c", currentActive: 0 }],
    batchSize: 12,
    maxActive: 10,
  });
  assert.equal(plan.perUser.b.assigned, 4);
  assert.equal(plan.perUser.a.assigned, 10);
  assert.equal(plan.perUser.c.assigned, 10);
  assert.equal(plan.unassigned.length, 6); // capacity exhausted → left unassigned
});

test("never allocates above zero capacity", () => {
  const plan = planAllocation({
    prospects: prospects(10),
    people: [{ id: "full", currentActive: 60 }, { id: "free", currentActive: 0 }],
    batchSize: 10,
    maxActive: 60,
  });
  assert.equal(plan.perUser.full.assigned, 0);
  assert.equal(plan.perUser.free.assigned, 10);
});

test("each prospect is assigned at most once", () => {
  const plan = planAllocation({
    prospects: prospects(100),
    people: Array.from({ length: 7 }, (_, i) => ({ id: `u${i}`, currentActive: i * 3 })),
    batchSize: 10,
    maxActive: 60,
  });
  const ids = plan.assignments.map((a) => a.contactId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(plan.assignments.length + plan.unassigned.length, 100);
});

test("segments are mixed fairly — nobody gets one segment only", () => {
  const plan = planAllocation({
    prospects: prospects(30, ["Healthcare", "D2C", "Manufacturing"]),
    people: [{ id: "a", currentActive: 0 }, { id: "b", currentActive: 0 }, { id: "c", currentActive: 0 }],
    batchSize: 10,
    maxActive: 100,
  });
  const segOf = new Map(prospects(30, ["Healthcare", "D2C", "Manufacturing"]).map((p) => [p.id, p.segment]));
  for (const u of ["a", "b", "c"]) {
    const segs = new Set(plan.assignments.filter((x) => x.userId === u).map((x) => segOf.get(x.contactId)));
    assert.equal(segs.size, 3, `${u} should get every segment`);
  }
});
