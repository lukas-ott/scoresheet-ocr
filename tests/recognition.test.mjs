import assert from "node:assert/strict";
import test from "node:test";
import { alphabet, bestGamePath, detectEnglishNotation, rankMoves } from "../dist/recognition.mjs";

function frames(text, symbols = alphabet) {
  const scores = [];
  for (const character of [...text, ""]) {
    scores.push(...symbols.map(letter => letter === character ? 0 : -30));
    scores.push(...symbols.map(letter => letter === "" ? 0 : -30));
  }
  return [{ text, scores }];
}

test("uses a legal German knight reading while retaining alternatives", () => {
  const ranked = rankMoves(frames("Bc3"), ["Nc3", "d4", "e4"], true);
  assert.equal(ranked[0].san, "Nc3");
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(rankMoves(frames("Bc3"), ["Nc3"], false)[0].score < -20);
});

test("full-path decoding keeps a weaker reading when it explains the next move", async () => {
  class Position {
    constructor(name) { this.name = name; }
    moves() { return { start: ["d4", "e4"], d4: ["d5"], e4: ["e5"] }[this.name]; }
    move(san) { this.previous = this.name; this.name = san; return { san }; }
    fen() { return this.name; }
    undo() { this.name = this.previous; }
  }
  const first = frames("d4");
  first[0].scores[alphabet.indexOf("e")] = -2;
  const path = await bestGamePath(Position, "start", [first, frames("e5")], false);
  assert.deepEqual(path.map(move => move.san), ["e4", "e5"]);
  assert.equal(path[0].check, true);
});

test("scores the move when OCR merges clock digits into its reading", () => {
  const ranked = rankMoves(frames("e41128"), ["e3", "d4", "e4", "Nf3"], false);
  assert.equal(ranked[0].san, "e4");
  assert.ok(ranked[0].score > -8);
});

test("detects English piece letters from the Latin OCR without counting alternate crops twice", () => {
  const readings = tokens => tokens.map(text => [{ text, symbols: [""] }, { text, symbols: [""] }]);
  assert.equal(detectEnglishNotation(readings(["Nf3", "Bb5+", "Re1 (1:27)", "d4", "Da5"])), true);
  assert.equal(detectEnglishNotation(readings(["Nf3", "Bb5", "Sf6", "Da5", "Le3"])), false);
  assert.equal(detectEnglishNotation(readings(["Nf3", "Bb5", "d4"])), false);
});

test("keeps a clear opening move when the general OCR cannot read its file letter", async () => {
  class OpeningPosition {
    moves() { return ["d4", "e4"]; }
    move(san) { return { san }; }
    fen() { return "opening"; }
    undo() {}
  }
  const [chessReading] = frames("e4");
  chessReading.scores[alphabet.indexOf("d")] = -4;
  const symbols = [...alphabet, "?"];
  const [generalReading] = frames("?4", symbols);
  generalReading.symbols = symbols;
  generalReading.scores[symbols.indexOf("d")] = -0.2;
  generalReading.scores[symbols.indexOf("e")] = -3;
  const path = await bestGamePath(OpeningPosition, "opening", [[chessReading, generalReading]], false, undefined, true);
  assert.equal(path[0].san, "e4");
  assert.equal(path[0].check, true);
});
