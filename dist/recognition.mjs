export const alphabet = ["", ..."KQRBNabcdefgh12345678x+#=O-"];
const indices = new Map(alphabet.map((letter, index) => [letter, index]));
const germanLookalikes = { N: ["B", "5", ""], Q: ["B", "R", ""], B: ["1", ""], R: [""] };

function logSum(a, b) {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  return Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));
}

function spellingScore(values, spelling, symbols = alphabet, lookup = indices) {
  const states = [0];
  for (const char of spelling) {
    if (!lookup.has(char)) return -Infinity;
    states.push(lookup.get(char), 0);
  }
  let previous = new Float64Array(states.length).fill(-Infinity);
  let next = new Float64Array(states.length);
  previous[0] = 0;
  for (let frame = 0; frame < values.length; frame += symbols.length) {
    for (const [i, symbol] of states.entries()) {
      let score = previous[i];
      if (i > 0) score = logSum(score, previous[i - 1]);
      if (i > 1 && symbol && symbol !== states[i - 2]) score = logSum(score, previous[i - 2]);
      next[i] = score + values[frame + symbol];
    }
    [previous, next] = [next, previous];
  }
  return logSum(previous.at(-1), previous.at(-2) ?? -Infinity);
}

function prefixScore(values, spelling, symbols = alphabet, lookup = indices) {
  const states = [0];
  for (const char of spelling) {
    const symbol = lookup.get(char);
    if (symbol === undefined) return -Infinity;
    states.push(symbol, 0);
  }
  const final = states.length - 2;
  if (final < 1) return 0;
  let previous = new Float64Array(final).fill(-Infinity);
  let next = new Float64Array(final);
  previous[0] = 0;
  let complete = -Infinity;
  for (let frame = 0; frame < values.length; frame += symbols.length) {
    for (let i = 0; i <= final; i++) {
      const symbol = states[i];
      let score = i === final ? -Infinity : previous[i];
      if (i > 0) score = logSum(score, previous[i - 1]);
      if (i > 1 && symbol && symbol !== states[i - 2]) score = logSum(score, previous[i - 2]);
      const total = score + values[frame + symbol];
      if (i === final) complete = logSum(complete, total);
      else next[i] = total;
    }
    [previous, next] = [next, previous];
  }
  return complete;
}

function spellings(san, german) {
  const core = san.replace(/[+#]$/, "");
  const base = [{ text: san, penalty: 0 }];
  if (core !== san) base.push({ text: core, penalty: 0.25 });
  const result = [...base];
  for (const form of base) {
    if (form.text.includes("x")) result.push({ text: form.text.replace("x", ""), penalty: form.penalty + 0.8 });
    if (form.text.includes("=")) result.push({ text: form.text.replace("=", ""), penalty: form.penalty + 0.8 });
  }
  if (german) {
    for (const form of [...result]) {
      for (const letter of germanLookalikes[form.text[0]] ?? []) {
        result.push({ text: letter + form.text.slice(1), penalty: form.penalty + (letter ? 1.5 : 3) });
      }
    }
  }
  return result;
}

const germanPieces = { N: "S", Q: "D", B: "L", R: "T" };

function latinSpellings(san, german, preferLatin = false) {
  const localized = german
    ? san.replace(/^[NQBR]|(?<==)[NQBR]/g, piece => germanPieces[piece])
    : san;
  const forms = spellings(localized, false);
  if (localized !== san) forms.push({ text: san, penalty: 1.2 });
  for (const form of [...forms]) {
    if (preferLatin) {
      const lowercase = form.text[0].toLowerCase() + form.text.slice(1);
      if (lowercase !== form.text) forms.push({ text: lowercase, penalty: form.penalty + 0.65 });
    }
    const uppercase = form.text.replace(/^[a-h]/, letter => letter.toUpperCase());
    if (uppercase !== form.text) forms.push({ text: uppercase, penalty: form.penalty + 0.55 });
    if (form.text.startsWith("O-O")) {
      forms.push({ text: form.text.replaceAll("O", "0"), penalty: form.penalty });
    }
    if (/^[SLDT]/.test(form.text)) {
      forms.push({ text: form.text.slice(1), penalty: form.penalty + 3 });
    }
  }
  return forms;
}

function looksLikeEnglishMove(text) {
  return /^(?:[KQRBN]?[a-h1-8]?x?[a-h][1-8](?:=?[QRBN])?[+#]?|[O0]-[O0](?:-[O0])?)$/.test(text.trim());
}

function readingRanker(reading, german, preferLatin = false) {
  const views = reading.map(({ scores, text, symbols }) => {
    const lookup = symbols ? new Map(symbols.map((letter, index) => [letter, index])) : indices;
    const movePrefix = text.match(/^(?:[KQRBNSDLT]?[a-h1-8]?[xX]?[a-h][1-8](?:=?[KQRBNSDLT])?[+#]?|[O0]-[O0](?:-[O0])?)(?=.)/i)?.[0];
    const hasTrailingInk = text.length > 5 || /[(:\s]/.test(text) || Boolean(movePrefix && /[0-9(]/.test(text.slice(movePrefix.length)));
    return {
      scores, symbols, lookup, text, best: spellingScore(scores, text, symbols, lookup),
      prefix: hasTrailingInk ? prefixScore(scores, movePrefix ?? text.slice(0, 3), symbols, lookup) : undefined,
    };
  });
  const strongerChessReading = preferLatin && !german
    && reading.some(view => !view.symbols && looksLikeEnglishMove(view.text))
    && !reading.some(view => view.symbols && looksLikeEnglishMove(view.text));
  const primaryWeight = strongerChessReading ? 0.60 : preferLatin ? 0.20 : 0.45;
  const latinWeight = preferLatin ? 1 : 0.85;
  const scoresByMove = new Map();
  const scoreMove = san => {
    if (scoresByMove.has(san)) return scoresByMove.get(san);
    let primary = -Infinity;
    let cleanPrimaryMatch = false;
    let latin = -Infinity;
    for (const view of views) {
      const forms = view.symbols ? latinSpellings(san, german, preferLatin) : spellings(san, german);
      let score = -Infinity;
      for (const form of forms) {
        const exact = spellingScore(view.scores, form.text, view.symbols, view.lookup) - view.best;
        const prefix = view.prefix === undefined ? -Infinity
          : prefixScore(view.scores, form.text, view.symbols, view.lookup) - view.prefix - 1.5;
        score = Math.max(score, Math.min(1, Math.max(exact, prefix)) - form.penalty);
      }
      if (view.symbols) latin = Math.max(latin, score);
      else {
        primary = Math.max(primary, score);
        if (strongerChessReading) {
          cleanPrimaryMatch ||= forms.some(form => form.penalty <= 0.8 && form.text === view.text);
        }
      }
    }
    const score = Number.isFinite(latin) ? primaryWeight * Math.max(-18, primary) + latinWeight * Math.max(-18, latin) : primary;
    const option = { san, score: score + (strongerChessReading && cleanPrimaryMatch ? 0.70 : 0) };
    scoresByMove.set(san, option);
    return option;
  };
  return legalMoves => legalMoves.map(scoreMove).sort((a, b) => b.score - a.score);
}

export function detectEnglishNotation(readings) {
  let english = 0;
  let german = 0;
  for (const reading of readings) {
    const text = reading.find(view => view.symbols)?.text.trim();
    const piece = text?.match(/^([NBRQSLTD])[a-h1-8]?x?[a-h][1-8](?=$|[+#(\s])/i)?.[1].toUpperCase();
    if (piece && "NBRQ".includes(piece)) english++;
    if (piece && "SLTD".includes(piece)) german++;
  }
  return english >= 3 && english >= 2 * german;
}

export function rankMoves(reading, legalMoves, german) {
  return readingRanker(reading, german)(legalMoves);
}

export async function bestGamePath(Chess, position, readings, german, onProgress = () => {}, preferLatin = false) {
  let paths = [{ position, moves: [], score: 0 }];
  const pathLimit = preferLatin ? 100 : 36;
  for (const [index, reading] of readings.entries()) {
    if (index % 4 === 0) await onProgress(index);
    const next = [];
    const rank = readingRanker(reading, german, preferLatin);
    for (const path of paths) {
      const chess = new Chess(path.position);
      const ranked = rank(chess.moves());
      for (const option of ranked.slice(0, 10)) {
        if (option.score < -21) continue;
        const move = chess.move(option.san);
        const latin = reading.find(view => view.symbols);
        const rawMatch = latin
          ? latinSpellings(move.san, german, preferLatin).some(form => form.penalty < 1 && form.text === latin.text)
          : reading.some(view => view.text === move.san);
        next.push({
          position: chess.fen(),
          moves: [...path.moves, {
            san: move.san,
            check: !rawMatch || option.san !== ranked[0].san || ranked[0].score - (ranked[1]?.score ?? -Infinity) < 2,
            options: ranked.slice(0, 4).filter(value => value.score >= -14).map(value => value.san),
          }],
          score: path.score + option.score,
        });
        chess.undo();
      }
    }
    if (!next.length) break;
    const positions = new Set();
    paths = [];
    for (const path of next.sort((a, b) => b.score - a.score)) {
      const positionKey = path.position.split(" ", 4).join(" ");
      if (positions.has(positionKey)) continue;
      positions.add(positionKey);
      paths.push(path);
      if (paths.length >= pathLimit) break;
    }
  }
  return paths[0].moves;
}
