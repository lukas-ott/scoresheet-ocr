const pieceLetters = {
  en: {},
  de: { S: "N", L: "B", T: "R", D: "Q" },
  fr: { C: "N", F: "B", T: "R", D: "Q", R: "K" },
  es: { C: "N", A: "B", T: "R", D: "Q", R: "K" },
};

export function parseEntry(entry, language, clockMode) {
  const text = entry.trim();
  const match = text.match(/^(\S+?)(?=\s|\(|\[|$)(.*)$/);
  if (!match) return { move: "", comment: "" };
  let [, move, tail] = match;
  if (move.endsWith("=")) {
    move = move.slice(0, -1);
    tail = " = " + tail;
  }
  const letters = pieceLetters[language] ?? pieceLetters.en;
  move = move
    .replace(/^[A-Z]/, letter => letters[letter] ?? letter)
    .replace(/([a-h][18])=?([A-Z])(?=[+#?!]*$)/, (_, square, piece) => square + "=" + (letters[piece] ?? piece))
    .replace(/^0-0(-0)?/, castle => castle.replaceAll("0", "O"))
    .replace(/[!?]+$/, "");
  const annotations = tail.match(/\([^)]*\)|\[[^\]]*\]|\S+/g) ?? [];
  const comment = annotations.map(annotation => {
    const value = annotation.replace(/^[([]|[)\]]$/g, "").trim();
    if (value === "=") return "Draw offered";
    if (clockMode !== "literal" && /^(?:\d+|\d+:\d{2}|\d+:\d{2}:\d{2})$/.test(value)) {
      const parts = value.split(":").map(Number);
      if (parts.every((part, index) => Number.isSafeInteger(part) && (index === 0 || part < 60))) {
        const seconds = parts.reduce((sum, part) => sum * 60 + part, 0);
        if (Number.isSafeInteger(seconds)) {
          const minutes = Math.floor(seconds / 60);
          const pad = number => String(number).padStart(2, "0");
          return "[%" + clockMode + " " + Math.floor(minutes / 60) + ":" + pad(minutes % 60) + ":" + pad(seconds % 60) + "]";
        }
      }
    }
    return annotation.replace(/[{}]/g, "");
  }).join(" ");
  return { move, comment };
}

export function formatPgn(moves, result) {
  const tags = [
    '[Event "?"]', '[Site "?"]', '[Date "????.??.??"]', '[Round "?"]',
    '[White "?"]', '[Black "?"]', '[Result "' + result + '"]',
  ].join("\n");
  const tokens = [];
  moves.forEach(({ san, comment }, index) => {
    if (index % 2 === 0) tokens.push((index / 2 + 1) + ".");
    if (index % 2 !== 0 && moves[index - 1].comment) tokens.push((Math.floor(index / 2) + 1) + "...");
    tokens.push(san);
    if (comment) tokens.push("{" + comment + "}");
  });
  tokens.push(result);
  return tags + "\n\n" + tokens.join(" ") + "\n";
}

export function nearbyMoves(reading, legalMoves) {
  const normalized = text => text.replace(/[x+#=]/g, "").toLowerCase();
  const written = normalized(reading);
  if (written.length < 2) return [];
  return legalMoves.filter(move => {
    const candidate = normalized(move);
    if (Math.abs(written.length - candidate.length) > 1) return false;
    let a = 0;
    let b = 0;
    let differences = 0;
    while (a < written.length && b < candidate.length) {
      if (written[a] === candidate[b]) {
        a++;
        b++;
      } else {
        if (++differences > 1) return false;
        if (written.length >= candidate.length) a++;
        if (candidate.length >= written.length) b++;
      }
    }
    return differences + written.length - a + candidate.length - b <= 1;
  }).slice(0, 4);
}
