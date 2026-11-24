import { test } from "node:test";
import assert from "node:assert/strict";
import { maximumScore, resultMessage } from "./result-message";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "./domain";

test("result percentage boundaries select the supplied sales copy", () => {
  for (const [score, icon] of [[0,"🔴"],[44,"🔴"],[45,"🟡"],[74,"🟡"],[75,"🟢"],[100,"🟢"]] as const) {
    const text = resultMessage(score, 100);
    assert.ok(text.includes(`${score}%`));
    assert.ok(text.includes(icon));
    assert.ok(text.includes("O'zgarish kundaligi"));
    assert.ok(text.length < 4096);
  }
});

test("percentage uses scored-question maxima and excludes category questions", () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, "../src/seed.json"), "utf8")) as Config;
  assert.equal(maximumScore(config), 55);
  assert.match(resultMessage(55, maximumScore(config)), /100%.*Intizomingiz yaxshi/);
  assert.match(resultMessage(25, 55), /45%.*Intizomni kuchaytirish kerak/);
  assert.match(resultMessage(24, 55), /44%.*O'zgarishni boshlash vaqti keldi/);
  assert.ok(!resultMessage(0, 0).includes("NaN"));
  assert.match(resultMessage(30, null), /qayta topshiring/);
});
